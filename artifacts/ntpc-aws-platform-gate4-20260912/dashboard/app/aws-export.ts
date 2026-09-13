import { POST } from './api/export/route';
export async function awsExportFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const check=await fetch('/api/export/authorize',{cache:'no-store',signal:init.signal});
  if(!check.ok) return check;
  const headers=new Headers(init.headers);headers.set('x-ntpc-access-role','decision');
  return POST(new Request(new URL(url,window.location.origin),{...init,headers}) as any);
}
