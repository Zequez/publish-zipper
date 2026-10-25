import { mkdir, rename, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { load } from "js-yaml";
import JSZip from "jszip";

import * as ghPages from "./publish-strategies/gh-pages";

const uploadsTmpDir = join(import.meta.dir, "uploads-tmp");
const uploadsDir = join(import.meta.dir, "uploads");

const PORT = 2233;
const uploadPage = Bun.file(join(import.meta.dir, "upload.html"));
const clientKeysDir = join(import.meta.dir, "client-keys");

export type RoutingEntry = {
  strategy: "gh-pages";
  deployKey: string;
  clientKey: string;
  repository: string;
  branch: string;
};

const routing = load(
  await Bun.file(join(import.meta.dir, "routing.yaml")).text(),
) as { [key: string]: RoutingEntry };

function matchSitesForClientKey(keyFile: string) {
  let sites: string[] = [];
  for (const [site, entry] of Object.entries(routing)) {
    if (entry.clientKey === keyFile) {
      sites.push(site);
    }
  }
  return sites;
}

Bun.serve({
  port: PORT,

  async fetch(request) {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/") {
      return serveUploadPage();
    }

    if (request.method === "POST" && url.pathname === "/publish") {
      const reqValResult = await validateRequest(request);
      if (reqValResult.type === "error") return reqValResult.response;
      const { file, key } = reqValResult;

      const keyValResult = await validateKey(key);
      if (keyValResult.type === "error") return keyValResult.response;
      const { keyFile } = keyValResult;

      console.log(key, keyFile);
      const sites = matchSitesForClientKey(keyFile);
      console.log(sites);
      for (const site of sites) {
        const entry = routing[site];
        console.log(entry);
      }

      const processResult = await processFile(sites, file);
      if (processResult.type === "error") return processResult.response;

      const site = processResult.site;
      const route = routing[site]!;

      if (route.strategy === "gh-pages") {
        await ghPages.publish(site, route);
      }

      return new Response(
        `Received ${file.name} (${file.size} bytes). Client key accepted. ZIP processing is not implemented yet.`,
        { status: 501 },
      );
    }

    return new Response("Not found", { status: 404 });
  },
});

console.log(`Publish Zipper listening on http://localhost:${PORT}`);

function serveUploadPage() {
  return new Response(uploadPage, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
    },
  });
}

async function validateRequest(
  request: Request,
): Promise<
  | { type: "error"; response: Response }
  | { type: "success"; file: File; key: string }
> {
  if (!request.headers.get("content-type")?.includes("multipart/form-data")) {
    return {
      type: "error",
      response: new Response("Expected multipart/form-data", {
        status: 400,
      }),
    };
  }

  let form: FormData;

  try {
    form = await request.formData();
  } catch {
    return {
      type: "error",
      response: new Response("Invalid multipart form data", {
        status: 400,
      }),
    };
  }

  const file = form.get("file");
  const key = form.get("key");

  if (!(file instanceof File) || file.size === 0) {
    return {
      type: "error",
      response: new Response("Missing or empty ZIP file", {
        status: 400,
      }),
    };
  }

  if (typeof key !== "string" || !key) {
    return {
      type: "error",
      response: new Response("Missing client key", {
        status: 400,
      }),
    };
  }

  return { type: "success", file, key };
}

async function validateKey(
  key: string,
): Promise<
  { type: "error"; response: Response } | { type: "success"; keyFile: string }
> {
  const keyFiles = new Bun.Glob("*").scan({
    cwd: clientKeysDir,
    onlyFiles: true,
  });

  for await (const keyFile of keyFiles) {
    const storedKey = (
      await Bun.file(join(clientKeysDir, keyFile)).text()
    ).trim();

    if (storedKey === key) {
      // processFile(file)
      return { type: "success", keyFile };
    }
  }

  return {
    type: "error",
    response: new Response("Invalid client key", {
      status: 403,
    }),
  };
}

async function processFile(
  validDomains: string[],
  file: File,
): Promise<
  { type: "error"; response: Response } | { type: "success"; site: string }
> {
  await mkdir(uploadsTmpDir, { recursive: true });

  const tempZip = join(uploadsTmpDir, crypto.randomUUID() + ".zip");
  await writeFile(tempZip, Buffer.from(await file.arrayBuffer()));

  let zip: JSZip;

  try {
    zip = await JSZip.loadAsync(await Bun.file(tempZip).arrayBuffer());
  } catch {
    return {
      type: "error",
      response: new Response("Invalid ZIP file", { status: 400 }),
    };
  }

  const cnameFile = zip.file("CNAME");

  if (!cnameFile || cnameFile.dir) {
    return {
      type: "error",
      response: new Response("ZIP must contain a root CNAME file", {
        status: 400,
      }),
    };
  }

  const cname = (await cnameFile.async("string")).trim();
  const site = validDomains.find(
    (domain) => domain.toLowerCase() === cname.toLowerCase(),
  );

  if (!site) {
    return {
      type: "error",
      response: new Response("Domain not authorized for this client key", {
        status: 403,
      }),
    };
  }

  const timestamp = new Date().toISOString();
  const uploadDir = join(uploadsDir, site, timestamp);
  const zipPath = join(uploadDir, "www.zip");
  const wwwDir = join(uploadDir, "www");

  await mkdir(uploadDir, { recursive: true });
  await rename(tempZip, zipPath);
  await writeFile(join(uploadDir, "status.json"), "{}");
  await mkdir(wwwDir);

  try {
    for (const entry of Object.values(zip.files)) {
      const destination = resolve(wwwDir, entry.name);

      // Prevent ZIP entries from writing outside the www directory.
      if (
        destination !== resolve(wwwDir) &&
        !destination.startsWith(resolve(wwwDir) + sep)
      ) {
        return {
          type: "error",
          response: new Response("ZIP contains an invalid path", {
            status: 400,
          }),
        };
      }

      if (entry.dir) {
        await mkdir(destination, { recursive: true });
      } else {
        await mkdir(join(destination, ".."), { recursive: true });
        await writeFile(destination, await entry.async("nodebuffer"));
      }
    }
  } catch {
    return {
      type: "error",
      response: new Response("Failed to extract ZIP", { status: 500 }),
    };
  }

  return { type: "success", site };
}
