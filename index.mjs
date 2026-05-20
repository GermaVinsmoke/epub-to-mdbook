#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import AdmZip from "adm-zip";
import { XMLParser } from "fast-xml-parser";
import TurndownService from "turndown";

function slugifyCliName(input, fallback = "book") {
  return input
    .toString()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || fallback;
}

function printUsage() {
  console.error("Usage: epub-to-mdbook --epub <book.epub> [--out <dir>]");
  console.error("Example: epub-to-mdbook --epub ./The_Go_Programming_Language-Brian-W_Kernighan-2015.epub");
}

function parseCliArgs(argv) {
  const args = argv.slice(2);

  if (args.length === 0 || args.includes("-h") || args.includes("--help")) {
    printUsage();
    process.exit(args.length === 0 ? 1 : 0);
  }

  let epubPath = null;
  let outputDir = null;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];

    if (arg === "--epub") {
      epubPath = args[i + 1] || null;
      i += 1;
      continue;
    }

    if (arg === "--out") {
      outputDir = args[i + 1] || null;
      i += 1;
      continue;
    }

    console.error(`Unknown argument: ${arg}`);
    printUsage();
    process.exit(1);
  }

  if (!epubPath) {
    console.error("Missing required --epub <book.epub> argument");
    printUsage();
    process.exit(1);
  }

  const derivedBookName = path.basename(epubPath, path.extname(epubPath));
  return {
    epubPath,
    outputDir: outputDir || `${slugifyCliName(derivedBookName)}_mdbook`,
  };
}

const { epubPath, outputDir } = parseCliArgs(process.argv);
const cwd = process.cwd();
const absEpub = path.resolve(cwd, epubPath);
const absOutput = path.resolve(cwd, outputDir);
const tempDir = path.join(absOutput, ".epub_extract");
const srcDir = path.join(absOutput, "src");
const assetsDir = path.join(srcDir, "assets");

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
});

const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
});

let currentPreBlocks = [];

turndown.addRule("preserveEmptyAnchors", {
  filter(node) {
    return (
      node.nodeName === "A" &&
      node.getAttribute("id") &&
      !node.getAttribute("href") &&
      !node.textContent.trim()
    );
  },
  replacement(_content, node) {
    return `<a id="${node.getAttribute("id")}"></a>`;
  },
});



function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readFile(file) {
  return fs.readFileSync(file, "utf8");
}

function writeFile(file, content) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, content, "utf8");
}

function cleanDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
  ensureDir(dir);
}

function asArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function stripTags(input = "") {
  return input.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function decodeHtmlEntities(input = "") {
  return input
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function htmlToPlainText(input = "") {
  return decodeHtmlEntities(
    input
      .replace(/<img[^>]*alt=["']([^"']*)["'][^>]*>/gi, "$1")
      .replace(/<img[^>]*>/gi, "[Image]")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n")
      .replace(/<[^>]+>/g, ""),
  );
}

function extractPreBlocks(html) {
  currentPreBlocks = [];
  return html.replace(/<pre\b[^>]*>([\s\S]*?)<\/pre>/gi, (_match, content) => {
    const text = htmlToPlainText(content).replace(/\r\n/g, "\n").trimEnd();
    const index = currentPreBlocks.length;
    currentPreBlocks.push(`\`\`\`\n${text}\n\`\`\``);
    return `\n\n@@@CODEBLOCK_${index}@@@\n\n`;
  });
}

function extractText(value) {
  if (!value) return "";
  if (typeof value === "string") return decodeHtmlEntities(stripTags(value));
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) return extractText(value[0]);
  if (typeof value === "object") {
    if (typeof value["#text"] === "string") return decodeHtmlEntities(stripTags(value["#text"]));
    for (const nested of Object.values(value)) {
      const text = extractText(nested);
      if (text) return text;
    }
  }
  return "";
}

function slugify(input, fallback) {
  const slug = decodeHtmlEntities(stripTags(input || ""))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || fallback;
}

function normalizeText(input = "") {
  return decodeHtmlEntities(stripTags(input))
    .replace(/\\\./g, ".")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function normalizeAuthor(input = "") {
  return input.replace(/\s*\[[^\]]+\]\s*$/, "").trim();
}

function extractEpub() {
  cleanDir(tempDir);
  const zip = new AdmZip(absEpub);
  zip.extractAllTo(tempDir, true);
}

function findOpfPath() {
  const containerPath = path.join(tempDir, "META-INF", "container.xml");
  const containerXml = parser.parse(readFile(containerPath));
  const rootfile = containerXml.container.rootfiles.rootfile["@_full-path"];
  return path.join(tempDir, rootfile);
}

function parseOpf(opfPath) {
  const opfDir = path.dirname(opfPath);
  const opf = parser.parse(readFile(opfPath));
  const pkg = opf.package;
  const metadata = pkg.metadata || {};
  const manifestItems = asArray(pkg.manifest.item);

  const manifest = new Map();
  for (const item of manifestItems) {
    manifest.set(item["@_id"], {
      id: item["@_id"],
      href: item["@_href"],
      mediaType: item["@_media-type"],
      fullPath: path.resolve(opfDir, item["@_href"]),
    });
  }

  const title = extractText(metadata["dc:title"] || metadata.title) || path.basename(absEpub, ".epub");

  const authors = asArray(metadata["dc:creator"] || metadata.creator)
    .map(extractText)
    .map(normalizeAuthor)
    .filter(Boolean)
    .filter((name) => !/chenjin5\.com/i.test(name));

  const uniqueAuthors = [...new Set(authors)];

  const tocItem = manifestItems.find(
    (item) => item["@_media-type"] === "application/x-dtbncx+xml",
  );

  if (!tocItem) {
    throw new Error("EPUB toc.ncx not found in manifest");
  }

  return {
    title,
    authors: uniqueAuthors.length ? uniqueAuthors : ["Unknown"],
    opfDir,
    manifestItems,
    tocPath: path.resolve(opfDir, tocItem["@_href"]),
  };
}

function parseTocNcx(tocPath, opfDir) {
  const toc = parser.parse(readFile(tocPath));
  const navMap = toc.ncx.navMap;

  function walk(points, depth = 0) {
    return asArray(points).map((point) => {
      const title = extractText(point.navLabel?.text) || `Section ${depth + 1}`;
      const rawSrc = point.content?.["@_src"] || "";
      const [href, anchor = ""] = rawSrc.split("#");

      return {
        title,
        rawSrc,
        href,
        anchor,
        sourcePath: path.resolve(path.dirname(tocPath), href),
        depth,
        children: walk(point.navPoint, depth + 1),
      };
    });
  }

  return walk(navMap.navPoint, 0);
}

function flattenToc(entries) {
  const flat = [];
  function visit(entry) {
    flat.push(entry);
    entry.children.forEach(visit);
  }
  entries.forEach(visit);
  return flat;
}

function copyAssets(opfDir, manifestItems) {
  ensureDir(assetsDir);

  const assetItems = manifestItems.filter((item) => {
    const type = item["@_media-type"] || "";
    return type.startsWith("image/") || type === "text/css" || type.includes("font");
  });

  const assetMap = new Map();

  for (const item of assetItems) {
    const src = path.resolve(opfDir, item["@_href"]);
    if (!fs.existsSync(src)) continue;

    const relativeFromOpf = item["@_href"];
    const dest = path.join(assetsDir, relativeFromOpf);

    ensureDir(path.dirname(dest));
    fs.copyFileSync(src, dest);
    assetMap.set(path.normalize(src), `assets/${relativeFromOpf}`);
  }

  return assetMap;
}

function buildFileMap(entries) {
  const fileMap = new Map();
  const prefixMap = new Map();

  entries.forEach((entry, index) => {
    const filename = `${String(index + 1).padStart(2, "0")}-${slugify(entry.title, `section-${index + 1}`)}.md`;
    fileMap.set(path.normalize(entry.sourcePath), filename);

    const prefix = path
      .normalize(entry.sourcePath)
      .replace(/_split_\d+(?=\.[^.]+$)/, "");

    if (!prefixMap.has(prefix)) {
      prefixMap.set(prefix, filename);
    }

    entry.filename = filename;
  });

  return { fileMap, prefixMap };
}

function findMappedFile(targetPath, fileMap, prefixMap) {
  const normalized = path.normalize(targetPath);
  if (fileMap.has(normalized)) return fileMap.get(normalized);

  const prefix = normalized.replace(/_split_\d+(?=\.[^.]+$)/, "");
  return prefixMap.get(prefix) || null;
}

function findImagePageAsset(targetPath, assetMap, imagePageCache) {
  const normalized = path.normalize(targetPath);
  if (imagePageCache.has(normalized)) return imagePageCache.get(normalized);
  if (!fs.existsSync(normalized)) {
    imagePageCache.set(normalized, null);
    return null;
  }

  const html = readFile(normalized);
  const imageMatch = html.match(/<img[^>]+src=["']([^"']+)["']/i);
  if (!imageMatch) {
    imagePageCache.set(normalized, null);
    return null;
  }

  const absoluteImagePath = path.normalize(
    path.resolve(path.dirname(normalized), imageMatch[1]),
  );
  const mappedAsset = assetMap.get(absoluteImagePath) || null;
  imagePageCache.set(normalized, mappedAsset);
  return mappedAsset;
}

function rewriteResourceLinks(html, chapterPath, assetMap, fileMap, prefixMap, imagePageCache) {
  return html.replace(/(src|href)=["']([^"']+)["']/g, (match, attr, rawUrl) => {
    if (
      rawUrl.startsWith("http://") ||
      rawUrl.startsWith("https://") ||
      rawUrl.startsWith("#") ||
      rawUrl.startsWith("data:") ||
      rawUrl.startsWith("mailto:")
    ) {
      return match;
    }

    const [rawPath, hash = ""] = rawUrl.split("#");
    const absoluteTargetPath = path.normalize(path.resolve(path.dirname(chapterPath), rawPath));

    const mappedAsset = assetMap.get(absoluteTargetPath);
    if (mappedAsset) {
      return `${attr}="${mappedAsset}"`;
    }

    if (attr === "href") {
      const mappedFile = findMappedFile(absoluteTargetPath, fileMap, prefixMap);
      if (mappedFile) {
        const suffix = hash ? `#${hash}` : "";
        return `${attr}="${mappedFile}${suffix}"`;
      }

      const imagePageAsset = findImagePageAsset(absoluteTargetPath, assetMap, imagePageCache);
      if (imagePageAsset) {
        return `${attr}="${imagePageAsset}"`;
      }
    }

    return match;
  });
}

function injectIdAnchors(html) {
  return html.replace(/<([a-zA-Z0-9]+)([^>]*\sid=["']([^"']+)["'][^>]*)>/g, (_match, tag, attrs, id) => {
    if (tag.toLowerCase() === "a") return `<${tag}${attrs}>`;
    return `<a id="${id}"></a><${tag}${attrs}>`;
  });
}

function removeLeadingDuplicateHeading(markdown, title) {
  const match = markdown.match(/^(#{1,6})\s+(.+?)\n+/s);
  if (!match) return markdown.trim();

  if (normalizeText(match[2]) === normalizeText(title)) {
    return markdown.slice(match[0].length).trim();
  }

  return markdown.trim();
}

function restorePreBlocks(markdown) {
  return markdown.replace(/\\?@\\?@\\?@CODEBLOCK(?:\\_|_)(\d+)\\?@\\?@\\?@/g, (_match, index) => {
    return currentPreBlocks[Number(index)] || "";
  });
}

function buildMarkdown(html, title) {
  const preparedHtml = extractPreBlocks(html);
  let markdown = turndown.turndown(preparedHtml);
  markdown = restorePreBlocks(markdown);
  markdown = markdown.replace(/```(<a id=)/g, "```\n$1");
  markdown = removeLeadingDuplicateHeading(markdown, title);
  markdown = `# ${title}\n\n${markdown}`.replace(/\n{3,}/g, "\n\n").trim();
  return `${markdown}\n`;
}

function renderSummary(entries) {
  const lines = ["# Summary", ""];

  function walk(entry) {
    const indent = "  ".repeat(entry.depth);
    lines.push(`${indent}- [${entry.title}](${entry.filename})`);
    entry.children.forEach(walk);
  }

  entries.forEach(walk);
  return `${lines.join("\n")}\n`;
}

function convertTocToMarkdown(tocEntries, assetMap, fileMap, prefixMap) {
  ensureDir(srcDir);

  const flatEntries = flattenToc(tocEntries);
  const imagePageCache = new Map();

  flatEntries.forEach((entry) => {
    const htmlRaw = readFile(entry.sourcePath);
    const withLinks = rewriteResourceLinks(
      htmlRaw,
      entry.sourcePath,
      assetMap,
      fileMap,
      prefixMap,
      imagePageCache,
    );
    const withAnchors = injectIdAnchors(withLinks);
    const markdown = buildMarkdown(withAnchors, entry.title);
    writeFile(path.join(srcDir, entry.filename), markdown);
  });

  writeFile(path.join(srcDir, "SUMMARY.md"), renderSummary(tocEntries));
}

function createBookToml(title, authors) {
  const toml = `[book]
title = ${JSON.stringify(title)}
authors = [${authors.map((author) => JSON.stringify(author)).join(", ")}]
language = "en"
multilingual = false
src = "src"

[output.html]
default-theme = "light"
preferred-dark-theme = "navy"
`;

  writeFile(path.join(absOutput, "book.toml"), toml);
}

function main() {
  if (!fs.existsSync(absEpub)) {
    console.error(`EPUB not found: ${absEpub}`);
    process.exit(1);
  }

  cleanDir(absOutput);
  ensureDir(srcDir);

  extractEpub();

  const opfPath = findOpfPath();
  const book = parseOpf(opfPath);
  const tocEntries = parseTocNcx(book.tocPath, book.opfDir);
  const flatEntries = flattenToc(tocEntries);
  const assetMap = copyAssets(book.opfDir, book.manifestItems);
  const { fileMap, prefixMap } = buildFileMap(flatEntries);

  convertTocToMarkdown(tocEntries, assetMap, fileMap, prefixMap);
  createBookToml(book.title, book.authors);

  console.log(`Done: ${absOutput}`);
  console.log(`Pages: ${flatEntries.length}`);
  console.log(`Run: cd ${outputDir} && mdbook serve`);
}

main();
