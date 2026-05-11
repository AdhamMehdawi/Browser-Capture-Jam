import { useState } from "react";
import { Key, Copy, AlertTriangle, CheckCircle2, Shield, Download, Trash2 } from "lucide-react";
import { useGetMe, useGenerateApiKey, getGetMeQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useUser, useClerk } from "@clerk/react";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { toast } from "sonner";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

export default function Settings() {
  const queryClient = useQueryClient();
  const { user } = useUser();
  const { signOut } = useClerk();
  const { data: profile, isLoading } = useGetMe();
  const generateApiKey = useGenerateApiKey();
  
  const [newKey, setNewKey] = useState<string | null>(null);

  const handleGenerateKey = () => {
    if (confirm("Generating a new API key will invalidate your old one. You will need to update the Chrome extension. Continue?")) {
      generateApiKey.mutate(undefined, {
        onSuccess: (data) => {
          setNewKey(data.apiKey);
          queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
          toast.success("New API key generated");
        },
        onError: () => {
          toast.error("Failed to generate API key");
        }
      });
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success("Copied to clipboard");
  };

  return (
    <div className="p-8 max-w-4xl mx-auto space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground mt-1">Manage your account and integration keys.</p>
      </div>

      {isLoading ? (
        <div className="space-y-6">
          <Skeleton className="h-[200px] w-full" />
          <Skeleton className="h-[300px] w-full" />
        </div>
      ) : (
        <div className="space-y-6">
          {/* Profile Section */}
          <Card>
            <CardHeader>
              <CardTitle>Profile</CardTitle>
              <CardDescription>Your personal information and account details.</CardDescription>
            </CardHeader>
            <CardContent className="flex items-center gap-6">
              <Avatar className="h-24 w-24 border border-border">
                <AvatarImage src={user?.imageUrl} />
                <AvatarFallback className="text-2xl">{user?.firstName?.[0] || "U"}</AvatarFallback>
              </Avatar>
              <div className="space-y-1 flex-1">
                <h3 className="text-xl font-bold">{user?.fullName || "User"}</h3>
                <p className="text-muted-foreground">{user?.primaryEmailAddress?.emailAddress}</p>
                <div className="pt-2 flex gap-4 text-sm">
                  <div className="bg-secondary px-3 py-1 rounded-md border border-border">
                    <span className="font-semibold text-foreground mr-2">{profile?.totalRecordings || 0}</span>
                    <span className="text-muted-foreground">Total Recordings</span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Extension Integration Section */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Key className="h-5 w-5 text-primary" />
                Extension Integration
              </CardTitle>
              <CardDescription>
                Your API key connects the Chrome extension to your VeloRec account.
                Keep this key secret and do not share it.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {newKey ? (
                <Alert className="bg-green-500/10 text-green-600 border-green-500/20">
                  <CheckCircle2 className="h-4 w-4" />
                  <AlertTitle>New Key Generated</AlertTitle>
                  <AlertDescription className="mt-2 text-foreground">
                    <p className="mb-2">Copy this key now. You will not be able to see it again.</p>
                    <div className="flex gap-2">
                      <Input readOnly value={newKey} className="font-mono bg-background" />
                      <Button onClick={() => copyToClipboard(newKey)} variant="secondary">
                        <Copy className="h-4 w-4 mr-2" /> Copy
                      </Button>
                    </div>
                  </AlertDescription>
                </Alert>
              ) : (
                <div className="space-y-4">
                  <div className="flex flex-col gap-2">
                    <label className="text-sm font-medium">Current API Key Status</label>
                    {profile?.apiKeyPreview ? (
                      <div className="flex items-center gap-3 p-3 border border-border rounded-md bg-muted/50 font-mono text-sm">
                        <Shield className="h-4 w-4 text-green-500" />
                        <span>{profile.apiKeyPreview}</span>
                      </div>
                    ) : (
                      <div className="text-sm text-muted-foreground italic">No API key generated yet.</div>
                    )}
                  </div>
                  
                  <div className="rounded-md bg-secondary p-4 text-sm border border-border">
                    <p className="font-semibold mb-1">How to setup the extension:</p>
                    <ol className="list-decimal list-inside space-y-1 ml-1 text-muted-foreground">
                      <li>Generate a new API key below</li>
                      <li>Click the VeloRec icon in your Chrome toolbar</li>
                      <li>Paste the key into the settings panel</li>
                    </ol>
                  </div>
                </div>
              )}
            </CardContent>
            <CardFooter className="border-t border-border pt-6 bg-muted/20">
              <Button 
                onClick={handleGenerateKey} 
                disabled={generateApiKey.isPending}
                className="w-full sm:w-auto"
              >
                {profile?.apiKeyPreview ? "Regenerate API Key" : "Generate API Key"}
              </Button>
            </CardFooter>
          </Card>

          {/* Data & Privacy */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Shield className="h-5 w-5" />
                Data & Privacy
              </CardTitle>
              <CardDescription>Export or delete your data in compliance with GDPR.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-sm font-medium">Export My Data</h4>
                  <p className="text-sm text-muted-foreground">Download all your recordings and metadata as JSON.</p>
                </div>
                <Button
                  variant="outline"
                  onClick={async () => {
                    try {
                      const apiBase = import.meta.env.VITE_API_URL ?? "";
                      const token = await (window as any).Clerk?.session?.getToken();
                      const res = await fetch(`${apiBase}/api/me/export`, {
                        headers: token ? { Authorization: `Bearer ${token}` } : {},
                      });
                      if (!res.ok) throw new Error("Export failed");
                      const blob = await res.blob();
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement("a");
                      a.href = url;
                      a.download = `velocap-export-${Date.now()}.json`;
                      a.click();
                      URL.revokeObjectURL(url);
                      toast.success("Data exported successfully");
                    } catch {
                      toast.error("Failed to export data");
                    }
                  }}
                >
                  <Download className="h-4 w-4 mr-2" />
                  Export
                </Button>
              </div>
              <hr className="border-border" />
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-sm font-medium text-destructive">Delete My Account</h4>
                  <p className="text-sm text-muted-foreground">Permanently delete your account and all recordings. This cannot be undone.</p>
                </div>
                <Button
                  variant="destructive"
                  onClick={async () => {
                    if (!confirm("Are you sure you want to delete your account? This action is irreversible — all recordings and data will be permanently deleted.")) return;
                    if (!confirm("This is your last chance. Type DELETE to confirm... (Click OK to proceed)")) return;
                    try {
                      const apiBase = import.meta.env.VITE_API_URL ?? "";
                      const token = await (window as any).Clerk?.session?.getToken();
                      const res = await fetch(`${apiBase}/api/me`, {
                        method: "DELETE",
                        headers: token ? { Authorization: `Bearer ${token}` } : {},
                      });
                      if (!res.ok) throw new Error("Delete failed");
                      toast.success("Account deleted");
                      signOut();
                    } catch {
                      toast.error("Failed to delete account");
                    }
                  }}
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete Account
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Sign Out */}
          <Card className="border-destructive/20">
            <CardHeader>
              <CardTitle className="text-destructive flex items-center gap-2">
                <AlertTriangle className="h-5 w-5" />
                Session
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground mb-4">
                Sign out of your account on this device.
              </p>
              <Button variant="destructive" onClick={() => signOut()}>
                Sign Out
              </Button>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
