#!/usr/bin/env node
// Package a pushed image. The digest must come from the registry push result.
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
const [image, digest, revision, output = "."] = process.argv.slice(2);
const version = JSON.parse(readFileSync("apps/api/package.json", "utf8")).version;
if (
  !image ||
  !image.endsWith(`:${version}`) ||
  !/^ghcr\.io\/[a-z0-9._/-]+:[a-z0-9][a-z0-9_.-]*$/.test(image) ||
  !/^sha256:[a-f0-9]{64}$/.test(digest || "") ||
  !/^[a-f0-9]{40}$/.test(revision || "")
) {
  throw new Error(
    "Usage: node scripts/package-nas.mjs <ghcr image:coreVersion> <pushed sha256 digest> <full source SHA> [output directory]",
  );
}
const dir = mkdtempSync(join(tmpdir(), "stm-nas-"));
try {
  mkdirSync(join(dir, "scripts/lib"), { recursive: true });
  for (const file of ["README-NAS.md", "docker-compose.caddy.yml", "Caddyfile"])
    cpSync(`deploy/${file}`, join(dir, file));
  for (const file of ["backup.sh", "restore.sh", "lib/deployment.sh"])
    cpSync(`scripts/${file}`, join(dir, "scripts", file));
  const template = readFileSync("deploy/docker-compose.yml", "utf8");
  const emptyEnv = join(dir, ".empty-env");
  writeFileSync(emptyEnv, "");
  const parsedImage = (file) =>
    JSON.parse(
      execFileSync(
        "docker",
        [
          "compose",
          "--project-name",
          "stm-package-check",
          "--project-directory",
          dir,
          "--env-file",
          emptyEnv,
          "--file",
          file,
          "config",
          "--format",
          "json",
        ],
        { encoding: "utf8" },
      ),
    ).services?.app?.image;
  if (!parsedImage(resolve("deploy/docker-compose.yml")))
    throw new Error("Compose template has no app image");
  const pattern = /^(\s+image:\s*)\S+\s*$/gm;
  if ([...template.matchAll(pattern)].length !== 1)
    throw new Error("Expected exactly one image in Compose template");
  const compose = template.replace(pattern, `$1${image}`);
  writeFileSync(join(dir, "docker-compose.yml"), compose);
  if (parsedImage(join(dir, "docker-compose.yml")) !== image)
    throw new Error("Parsed Compose app.image does not match VERSION image");
  rmSync(emptyEnv);
  writeFileSync(
    join(dir, "VERSION.json"),
    JSON.stringify(
      {
        coreVersion: version,
        sourceRevision: revision,
        image,
        digest,
        packagedAt: new Date().toISOString(),
      },
      null,
      2,
    ) + "\n",
  );
  const files = [
    "README-NAS.md",
    "docker-compose.yml",
    "docker-compose.caddy.yml",
    "Caddyfile",
    "scripts/backup.sh",
    "scripts/restore.sh",
    "scripts/lib/deployment.sh",
    "VERSION.json",
  ];
  writeFileSync(
    join(dir, "SHA256SUMS"),
    files
      .map(
        (f) =>
          `${createHash("sha256")
            .update(readFileSync(join(dir, f)))
            .digest("hex")}  ${f}`,
      )
      .join("\n") + "\n",
  );
  mkdirSync(output, { recursive: true });
  const archive = resolve(output, `sendtomyself-nas-${version}.zip`);
  rmSync(archive, { force: true });
  execFileSync("zip", ["-q", archive, ...files, "SHA256SUMS"], { cwd: dir });
  writeFileSync(
    `${archive}.sha256`,
    `${createHash("sha256").update(readFileSync(archive)).digest("hex")}  ${archive.split("/").pop()}\n`,
  );
  console.log(archive);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
