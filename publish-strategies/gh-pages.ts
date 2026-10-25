import { readdir } from "node:fs/promises";
import { join } from "node:path";

const uploadsDir = join(import.meta.dir, "..", "uploads");
const deployKeysDir = join(import.meta.dir, "..", "deploy-keys");

export async function publish(
  site: string,
  routing: {
    deployKey: string;
    repository: string;
    branch: string;
  },
): Promise<void> {
  const uploads = await readdir(join(uploadsDir, site));
  const timestamp = uploads.sort().at(-1);

  if (!timestamp) throw new Error(`No uploads found for ${site}`);

  const wwwDir = join(uploadsDir, site, timestamp, "www");
  const deployKey = join(deployKeysDir, routing.deployKey);
  const repository = `git@github.com:${routing.repository}.git`;

  const env = {
    ...process.env,
    GIT_SSH_COMMAND: `ssh -i "${deployKey}" -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=yes`,
  };

  async function git(...args: string[]) {
    const proc = Bun.spawn(["git", ...args], {
      cwd: wwwDir,
      env,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [exitCode, stdout, stderr] = await Promise.all([
      proc.exited,
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);

    if (exitCode !== 0) {
      throw new Error(`git ${args[0]} failed: ${stderr || stdout}`);
    }
  }

  await git("init");
  await git("checkout", "-B", routing.branch);
  await git("add", "--all");
  await git(
    "-c",
    "user.name=Publish Zipper",
    "-c",
    "user.email=publish-zipper@localhost",
    "commit",
    "-m",
    `Publish ${site} at ${timestamp}`,
  );
  await git("push", "--force", repository, routing.branch);
}
