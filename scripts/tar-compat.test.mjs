import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { after, before, test } from "node:test";
import { createGunzip, gzipSync } from "node:zlib";

const require = createRequire(import.meta.url);
const mobileRequire = createRequire(new URL("../apps/mobile/package.json", import.meta.url));
const expoRequire = createRequire(mobileRequire.resolve("expo/package.json"));
const cliRequire = createRequire(expoRequire.resolve("@expo/cli/package.json"));
const cacheRequire = createRequire(cliRequire.resolve("cacache/package.json"));
const supabasePackage = require.resolve("supabase/package.json");
const supabaseRequire = createRequire(supabasePackage);
const tar = cliRequire("tar");
let temporary;
let archive;
let archiveFile;
let expoNpm;
let expoTar;

// Independent tiny ustar fixtures: no registry, provider, system tar, or tar.create dependency.
function member(path, contents = "", type = "0", linkpath = "") {
  const body = Buffer.from(contents);
  const header = Buffer.alloc(512);
  header.write(path, 0, 100);
  for (const [offset, length, value] of [[100, 8, 0o644], [108, 8, 0], [116, 8, 0], [124, 12, body.length], [136, 12, 0]]) {
    header.write(value.toString(8).padStart(length - 1, "0") + "\0", offset, length);
  }
  header.fill(" ", 148, 156);
  header.write(type, 156, 1);
  header.write(linkpath, 157, 100);
  header.write("ustar\0", 257, 6);
  header.write("00", 263, 2);
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  header.write(checksum.toString(8).padStart(6, "0") + "\0 ", 148, 8);
  return Buffer.concat([header, body, Buffer.alloc((512 - body.length % 512) % 512)]);
}

function tarball(members) {
  return gzipSync(Buffer.concat([...members, Buffer.alloc(1024)]));
}

async function absent(path) {
  await assert.rejects(access(path), { code: "ENOENT" });
}

before(async () => {
  temporary = await mkdtemp(join(tmpdir(), "plusmy-tar-compat-"));
  // Importing Expo initializes its cache; never use the operator's Expo home/session.
  const previousHome = process.env.__UNSAFE_EXPO_HOME_DIRECTORY;
  process.env.__UNSAFE_EXPO_HOME_DIRECTORY = join(temporary, "expo-home");
  try {
    expoNpm = cliRequire("./build/src/utils/npm.js");
    expoTar = cliRequire("./build/src/utils/tar.js");
  } finally {
    if (previousHome === undefined) delete process.env.__UNSAFE_EXPO_HOME_DIRECTORY;
    else process.env.__UNSAFE_EXPO_HOME_DIRECTORY = previousHome;
  }
  archive = tarball([
    member("package/gitignore", "node_modules\n"),
    member("package/HelloWorld/readme.txt", "template contents\n"),
    member("package/omit.txt", "not selected\n"),
  ]);
  archiveFile = join(temporary, "template.tgz");
  await writeFile(archiveFile, archive);
});

after(async () => {
  if (temporary) await rm(temporary, { recursive: true, force: true });
});

test("locked consumers resolve only tar 7.5.22 with the expected CommonJS shape", () => {
  assert.equal(cliRequire("./package.json").version, "0.22.28");
  assert.equal(cacheRequire("./package.json").version, "18.0.4");
  assert.equal(supabaseRequire("./package.json").version, "2.83.0");
  for (const consumer of [cliRequire, cacheRequire, supabaseRequire]) {
    assert.equal(consumer("tar/package.json").version, "7.5.22");
    assert.equal(typeof consumer("tar").extract, "function");
  }
  assert.equal(tar.__esModule, true);
  assert.equal(tar.default, undefined, "the old Expo default-import helper must not accidentally work");
});

test("actual Expo streaming extraction preserves strip, entry transforms, and checksum", async () => {
  const cwd = join(temporary, "stream");
  const checksum = await expoNpm.extractNpmTarballAsync(Readable.from([archive]), { cwd, name: "TarCompat" });
  assert.equal(checksum, createHash("md5").update(archive).digest("hex"));
  assert.equal(await readFile(join(cwd, ".gitignore"), "utf8"), "node_modules\n");
  assert.equal(await readFile(join(cwd, "TarCompat/readme.txt"), "utf8"), "template contents\n");
  await absent(join(cwd, "package"));
});

test("actual Expo local wrapper preserves selection, filter, custom strip, and sha256", async () => {
  const cwd = join(temporary, "local");
  const checksum = await expoNpm.extractLocalNpmTarballAsync(archiveFile, {
    cwd,
    strip: 2,
    checksumAlgorithm: "sha256",
    fileList: ["package/HelloWorld", "package/gitignore"],
    filter: (path) => !path.endsWith("gitignore"),
  });
  assert.equal(checksum, createHash("sha256").update(archive).digest("hex"));
  assert.deepEqual(await readdir(cwd), ["readme.txt"]);
});

test("actual Expo JS fallback extracts a local tarball when native tar cannot launch", async () => {
  const cwd = join(temporary, "fallback");
  const emptyPath = join(temporary, "no-native-tools");
  await mkdir(cwd);
  await mkdir(emptyPath);
  const previousPath = process.env.PATH;
  process.env.PATH = emptyPath;
  try {
    await expoTar.extractAsync(archiveFile, cwd);
  } finally {
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
  }
  assert.equal(await readFile(join(cwd, "package/gitignore"), "utf8"), "node_modules\n");
  assert.equal(await readFile(join(cwd, "package/HelloWorld/readme.txt"), "utf8"), "template contents\n");
});

test("actual Expo streaming extraction rejects invalid archives", async () => {
  await assert.rejects(expoNpm.extractNpmTarballAsync(Readable.from([Buffer.from("not a tarball")]), {
    cwd: join(temporary, "invalid"),
  }));
});

for (const [name, entry] of [
  ["traversal", member("../sentinel.txt", "overwritten\n")],
  ["hardlink", member("escape", "", "1", "../sentinel.txt")],
]) {
  test(`actual Expo extraction refuses ${name} escape without touching the sentinel`, async () => {
    const cwd = join(temporary, `containment-${name}`);
    const sentinel = join(temporary, "sentinel.txt");
    await writeFile(sentinel, "unchanged\n");
    await assert.rejects(expoNpm.extractNpmTarballAsync(Readable.from([tarball([entry])]), { cwd, strip: 0 }), /contains '\.\.'/);
    assert.equal(await readFile(sentinel, "utf8"), "unchanged\n");
    await absent(join(cwd, "escape"));
  });
}

test("contained symlink chains are extracted or reported as failures, never silently omitted", async () => {
  const cwd = join(temporary, "contained-symlinks");
  const links = tarball([
    member("package/payload", "contained\n"),
    member("package/alias", "", "2", "payload"),
    member("package/alias2", "", "2", "alias"),
  ]);
  let extractionFailed = false;
  try {
    await expoNpm.extractNpmTarballAsync(Readable.from([links]), { cwd });
  } catch (error) {
    assert.match(error.message, /Cannot extract through symbolic link/);
    extractionFailed = true;
  }
  if (!extractionFailed) assert.equal(await readFile(join(cwd, "alias2"), "utf8"), "contained\n");
});

test("the Expo JS fallback does not silently omit contained symlink chains", async () => {
  const cwd = join(temporary, "fallback-symlinks");
  const links = join(temporary, "fallback-symlinks.tgz");
  await mkdir(cwd);
  await writeFile(links, tarball([
    member("payload", "contained\n"),
    member("alias", "", "2", "payload"),
    member("alias2", "", "2", "alias"),
  ]));
  const previousPath = process.env.PATH;
  process.env.PATH = join(temporary, "no-native-tools");
  let extractionFailed = false;
  try {
    await expoTar.extractAsync(links, cwd);
  } catch (error) {
    assert.match(error.message, /Cannot extract through symbolic link/);
    extractionFailed = true;
  } finally {
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
  }
  if (!extractionFailed) assert.equal(await readFile(join(cwd, "alias2"), "utf8"), "contained\n");
});

test("actual Expo streaming extraction aborts a bounded high-ratio gzip fixture", async () => {
  const bomb = tarball([member("package/zeros", Buffer.alloc(8 * 1024 * 1024))]);
  assert.ok(bomb.length < 9000, "the fixture should exceed tar's default 1000:1 ratio");
  await assert.rejects(expoNpm.extractNpmTarballAsync(Readable.from([bomb]), {
    cwd: join(temporary, "ratio-limit"),
  }), /max decompression ratio exceeded/);
});

test("actual Expo member selection handles a tiny archive with a very deep GNU long path", async () => {
  const deep = tarball([
    member("././@LongLink", "a/".repeat(12000) + "payload\0", "L"),
    member("payload", "ignored\n"),
  ]);
  const cwd = join(temporary, "deep-path");
  await expoNpm.extractNpmTarballAsync(Readable.from([deep]), { cwd, fileList: ["not-selected"] });
  assert.deepEqual(await readdir(cwd), []);
});

test("cacache buffer/stream integrity, verification, and temporary-directory lifecycle remain usable", async () => {
  const cache = cliRequire("cacache");
  const cwd = join(temporary, "npm-cache");
  const contents = Buffer.from("cached payload\n");
  const integrity = await cache.put(cwd, "buffer", contents);
  const retrieved = await cache.get(cwd, "buffer");
  assert.deepEqual(retrieved.data, contents);
  assert.equal(retrieved.integrity, integrity.toString());
  await assert.rejects(cache.put(cwd, "bad-integrity", contents, { integrity: "sha512-AAAA" }), { code: "EINTEGRITY" });
  await pipeline(Readable.from([contents]), cache.put.stream(cwd, "stream"));
  const chunks = [];
  for await (const chunk of cache.get.stream(cwd, "stream")) chunks.push(chunk);
  assert.deepEqual(Buffer.concat(chunks), contents);
  let successPath;
  await cache.tmp.withTmp(cwd, async (path) => {
    successPath = path;
    await writeFile(join(path, "disposable"), contents);
  });
  await absent(successPath);
  let failurePath;
  await assert.rejects(cache.tmp.withTmp(cwd, async (path) => {
    failurePath = path;
    throw new Error("fixture failure");
  }), /fixture failure/);
  await absent(failurePath);
  const verified = await cache.verify(cwd);
  assert.equal(verified.verifiedContent, 1);
  await cache.rm.entry(cwd, "buffer");
  await assert.rejects(cache.get(cwd, "buffer"), { code: "ENOENT" });
});

test("Supabase's named ESM import and selected-member gunzip/extract pipeline remain compatible", async () => {
  const namedImport = spawnSync(process.execPath, ["--input-type=module", "--eval",
    'import { extract } from "tar"; if (typeof extract !== "function") process.exit(1);',
  ], { cwd: dirname(supabasePackage), encoding: "utf8", timeout: 10000 });
  assert.equal(namedImport.status, 0, namedImport.stderr);
  const cwd = join(temporary, "supabase-extraction");
  await mkdir(cwd);
  const binaryArchive = join(temporary, "supabase-fixture.tgz");
  await writeFile(binaryArchive, tarball([member("supabase", "fixture executable\n"), member("ignored", "excluded\n")]));
  await pipeline(createReadStream(binaryArchive), createGunzip(), supabaseRequire("tar").extract({ cwd }, ["supabase"]));
  assert.equal(await readFile(join(cwd, "supabase"), "utf8"), "fixture executable\n");
  await absent(join(cwd, "ignored"));
});
