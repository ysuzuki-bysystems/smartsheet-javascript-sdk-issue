#!/usr/bin/env -S node --experimental-strip-types --disable-warning=ExperimentalWarning

import * as http from "node:http";
import { text } from "node:stream/consumers";
import { pipeline } from "node:stream/promises";

async function proxyRequest(rid: string, req: http.IncomingMessage): Promise<Request> {
  const url = new URL(req.url ?? "", "https://api.smartsheet.com/");
  const body = (req.method !== "GET" && req.method !== "HEAD") ? await text(req) : null;
  const headers = new Headers(Object.entries(req.headersDistinct).flatMap(([k,v]) => (v ?? []).map<[string, string]>(v2 => [k, v2])));
  for (const name of ["host", "connection"]) {
    headers.delete(name);
  }

  const headersForDump = new Headers(headers);
  headersForDump.delete("authorization");

  console.log("REQUEST", rid, url.href, req.method, JSON.stringify(Object.fromEntries(headersForDump)), body);

  return new Request(url, {
    method: req.method,
    headers,
    body,
  });
}

async function writeResponse(rid: string, res: Response, dest: http.ServerResponse): Promise<void> {
  const status = res.status;
  const headers = new Headers(res.headers);
  const body = await res.text();

  console.log("RESPONSE", rid, status, JSON.stringify(Object.fromEntries(headers)), body);

  for (const name of ["content-length", "content-encoding", "transfer-encoding", "connection"]) {
    headers.delete(name);
  }
  dest.setHeaders(headers);
  dest.writeHead(status);
  await pipeline(body, dest);
}

function newHandler(): (req: http.IncomingMessage, res: http.ServerResponse) => void {
  let gen = 0;

  return function handler(req, res) {
    const rid = `r${gen++}`;
    const task = (async () => {
      try {
        const preq = await proxyRequest(rid, req);
        const pres = await fetch(preq);
        await writeResponse(rid, pres, res);
      } catch (e) {
        res.destroy(e instanceof Error ? e : new Error(String(e)));
        throw e;
      }
    })();
    task.catch((e) => {
      if ((e as unknown as Record<string, unknown>)["code"] === "ERR_STREAM_PREMATURE_CLOSE") {
        return;
      }

      console.error(rid, e);
    });
  }
}

async function main() {
  const server = http.createServer();

  server.on("request", newHandler());

  server.listen(8080);
}

await main();
