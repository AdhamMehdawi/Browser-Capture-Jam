import {
  BlobServiceClient,
  BlobSASPermissions,
  generateBlobSASQueryParameters,
  StorageSharedKeyCredential,
  type BlockBlobClient,
  type ContainerClient,
} from "@azure/storage-blob";
import { Readable } from "stream";
import { randomUUID } from "crypto";
import {
  ObjectAclPolicy,
  ObjectPermission,
  canAccessObject,
  setObjectAclPolicy,
} from "./objectAcl";

// Layout inside the container:
//   objects/<uuid>      — private entities (recordings, captures)
//   public/<path>       — public assets (served unauthenticated)
const PRIVATE_PREFIX = "objects";
const PUBLIC_PREFIX = "public";

export class ObjectNotFoundError extends Error {
  constructor() {
    super("Object not found");
    this.name = "ObjectNotFoundError";
    Object.setPrototypeOf(this, ObjectNotFoundError.prototype);
  }
}

export class ObjectStorageService {
  private container: ContainerClient;
  private sharedKey: StorageSharedKeyCredential;
  private accountName: string;

  constructor() {
    const conn = process.env.STORAGE_CONNECTION_STRING;
    if (!conn) {
      throw new Error(
        "STORAGE_CONNECTION_STRING not set. Provision the storage account " +
          "and wire the connection string (see infra/envs/dev/main.tf)."
      );
    }
    const containerName = process.env.STORAGE_CONTAINER || "assets";

    const svc = BlobServiceClient.fromConnectionString(conn);
    this.container = svc.getContainerClient(containerName);

    // SAS generation needs the raw account key; pull it from the connection
    // string. Azure SDK's fromConnectionString hides the key internally.
    const accountMatch = conn.match(/AccountName=([^;]+)/i);
    const keyMatch = conn.match(/AccountKey=([^;]+)/i);
    if (!accountMatch || !keyMatch) {
      throw new Error(
        "STORAGE_CONNECTION_STRING must include AccountName + AccountKey"
      );
    }
    this.accountName = accountMatch[1];
    this.sharedKey = new StorageSharedKeyCredential(
      accountMatch[1],
      keyMatch[1]
    );
  }

  getPrivateObjectDir(): string {
    return PRIVATE_PREFIX;
  }

  async searchPublicObject(filePath: string): Promise<BlockBlobClient | null> {
    const blob = this.container.getBlockBlobClient(
      `${PUBLIC_PREFIX}/${filePath}`
    );
    return (await blob.exists()) ? blob : null;
  }

  async downloadObject(
    blob: BlockBlobClient,
    cacheTtlSec: number = 3600
  ): Promise<Response> {
    const props = await blob.getProperties();
    const policy = await getAclVisibility(blob);
    const isPublic = policy === "public";

    const dl = await blob.download();
    const nodeStream = dl.readableStreamBody as NodeJS.ReadableStream | undefined;
    if (!nodeStream) {
      throw new ObjectNotFoundError();
    }
    const webStream = Readable.toWeb(nodeStream as Readable) as ReadableStream;

    const headers: Record<string, string> = {
      "Content-Type": props.contentType ?? "application/octet-stream",
      "Cache-Control": `${isPublic ? "public" : "private"}, max-age=${cacheTtlSec}`,
    };
    if (props.contentLength != null) {
      headers["Content-Length"] = String(props.contentLength);
    }

    return new Response(webStream, { headers });
  }

  async getObjectEntityUploadURL(): Promise<string> {
    const id = randomUUID();
    const blobName = `${PRIVATE_PREFIX}/${id}`;
    const blob = this.container.getBlockBlobClient(blobName);

    const sas = generateBlobSASQueryParameters(
      {
        containerName: this.container.containerName,
        blobName,
        permissions: BlobSASPermissions.parse("cw"),
        startsOn: new Date(Date.now() - 60_000),
        expiresOn: new Date(Date.now() + 15 * 60_000),
      },
      this.sharedKey
    ).toString();

    return `${blob.url}?${sas}`;
  }

  async getObjectEntityFile(objectPath: string): Promise<BlockBlobClient> {
    if (!objectPath.startsWith("/objects/")) {
      throw new ObjectNotFoundError();
    }
    const entityId = objectPath.slice("/objects/".length);
    if (!entityId) {
      throw new ObjectNotFoundError();
    }
    const blob = this.container.getBlockBlobClient(
      `${PRIVATE_PREFIX}/${entityId}`
    );
    if (!(await blob.exists())) {
      throw new ObjectNotFoundError();
    }
    return blob;
  }

  // Accepts an upload URL (SAS) or a bare /objects/<id> path; returns the
  // canonical /objects/<id> form.
  normalizeObjectEntityPath(rawPath: string): string {
    try {
      const u = new URL(rawPath);
      const segments = u.pathname.split("/").filter(Boolean);
      // [container, "objects", "<id>", ...]
      const idx = segments.indexOf(PRIVATE_PREFIX);
      if (idx >= 0 && idx < segments.length - 1) {
        return `/objects/${segments.slice(idx + 1).join("/")}`;
      }
    } catch {
      /* not a URL */
    }
    return rawPath;
  }

  async trySetObjectEntityAclPolicy(
    rawPath: string,
    aclPolicy: ObjectAclPolicy
  ): Promise<string> {
    const normalized = this.normalizeObjectEntityPath(rawPath);
    if (!normalized.startsWith("/")) {
      return normalized;
    }
    const blob = await this.getObjectEntityFile(normalized);
    await setObjectAclPolicy(blob, aclPolicy);
    return normalized;
  }

  async canAccessObjectEntity({
    userId,
    objectFile,
    requestedPermission,
  }: {
    userId?: string;
    objectFile: BlockBlobClient;
    requestedPermission?: ObjectPermission;
  }): Promise<boolean> {
    return canAccessObject({
      userId,
      objectFile,
      requestedPermission: requestedPermission ?? ObjectPermission.READ,
    });
  }
}

async function getAclVisibility(
  blob: BlockBlobClient
): Promise<"public" | "private" | null> {
  const props = await blob.getProperties();
  const raw = props.metadata?.customAclPolicy;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed.visibility ?? null;
  } catch {
    return null;
  }
}
