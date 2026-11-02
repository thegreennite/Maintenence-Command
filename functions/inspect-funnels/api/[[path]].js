// The app lives at /inspect-funnels/, so its API calls arrive as /inspect-funnels/api/...;
// pass them to the Worker exactly like functions/api/[[path]].js does for /api/....
import { onRequest as proxyApi } from "../../api/[[path]].js";

export async function onRequest(context) {
  const url = new URL(context.request.url);
  url.pathname = url.pathname.replace(/^\/inspect-funnels/, "");
  return proxyApi({ ...context, request: new Request(url, context.request) });
}
