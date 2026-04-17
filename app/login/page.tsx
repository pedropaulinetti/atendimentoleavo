import { login } from "./actions";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { MessageCircle } from "lucide-react";

export default async function LoginPage({
  searchParams,
}: { searchParams: Promise<{ from?: string; error?: string }> }) {
  const { from = "/monitor", error } = await searchParams;

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-zinc-900 text-white">
            <MessageCircle className="size-5" />
          </div>
          <p className="text-sm text-zinc-500">Atendimento Leavo</p>
        </div>
        <Card className="shadow-sm">
          <CardHeader className="space-y-1 pb-4">
            <CardTitle className="text-xl">Entrar na sua conta</CardTitle>
            <CardDescription>
              Use seu e-mail e senha para acessar o painel
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form action={login} className="space-y-4">
              <input type="hidden" name="from" value={from} />
              <div className="space-y-1.5">
                <Label htmlFor="email">E-mail</Label>
                <Input id="email" name="email" type="email" required placeholder="voce@empresa.com" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="password">Senha</Label>
                <Input id="password" name="password" type="password" required placeholder="••••••••" />
              </div>
              {error && (
                <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600 border border-red-200">
                  {error}
                </p>
              )}
              <Button type="submit" className="w-full">Entrar</Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
