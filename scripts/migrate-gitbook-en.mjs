import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const repoRoot = path.resolve(import.meta.dirname, "..");
const sourceRoot = path.resolve(repoRoot, "../YCloud-helpdocs/help_center/en");
const sourceAssets = path.join(sourceRoot, ".gitbook/assets");
const targetAssets = path.join(repoRoot, "images/gitbook");

const excludedPrefixes = ["developer/"];
const partnerPrefix = "partnership/";
const brokenRouteMap = new Map([
  ["/broken/pages/jvCjAdVkX3V6L9gO2OF0", "/help/campaign/create-a-whatsapp-marketing-campaign"],
  ["/broken/pages/ZCuMneQAG8HidHA2gLr6", "/help/shop/creatstore"],
]);

const titleBySource = new Map();
const assetUrlMap = new Map();

function walk(dir, predicate = () => true) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walk(fullPath, predicate));
    } else if (predicate(fullPath)) {
      out.push(fullPath);
    }
  }
  return out;
}

function rmIfExists(relativePath) {
  const fullPath = path.join(repoRoot, relativePath);
  if (fs.existsSync(fullPath)) {
    fs.rmSync(fullPath, { recursive: true, force: true });
  }
}

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function stripEmoji(value) {
  return value
    .replace(/[\p{Extended_Pictographic}\uFE0F]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function titleFromPath(relativePath) {
  const base = path.basename(relativePath, path.extname(relativePath));
  const name = base.toLowerCase() === "readme" ? path.basename(path.dirname(relativePath)) : base;
  return name
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function parseSummary() {
  const summary = fs.readFileSync(path.join(sourceRoot, "SUMMARY.md"), "utf8");
  const sections = [];
  let current = {
    group: "Overview",
    pages: [],
  };
  sections.push(current);

  for (const line of summary.split(/\r?\n/)) {
    const heading = line.match(/^##\s+(.+)$/);
    if (heading) {
      current = {
        group: stripEmoji(heading[1]).replace(/\b[A-Z]{3,}\b/g, (word) =>
          word[0] + word.slice(1).toLowerCase(),
        ),
        pages: [],
      };
      sections.push(current);
      continue;
    }

    const item = line.match(/^\s*\*\s+\[([^\]]+)\]\(([^)]+)\)/);
    if (!item) continue;

    const [, title, rawLink] = item;
    if (/^https?:\/\//i.test(rawLink)) continue;

    const normalized = normalizeSourceRel(rawLink, "SUMMARY.md");
    if (!normalized || normalized === "SUMMARY.md") continue;

    titleBySource.set(normalized, stripEmoji(title));
    current.pages.push(normalized);
  }

  return sections
    .map((section) => ({
      group: section.group,
      pages: [...new Set(section.pages)],
    }))
    .filter((section) => section.pages.length > 0);
}

function normalizeSourceRel(rawLink, fromRel) {
  const decoded = decodeHtml(rawLink).split("#")[0].split("?")[0];
  if (!decoded || /^https?:\/\//i.test(decoded)) return null;

  const fromDir = path.posix.dirname(fromRel);
  let normalized = path.posix.normalize(path.posix.join(fromDir, decoded));
  if (normalized === ".") normalized = "README.md";
  if (normalized.endsWith("/")) normalized += "README.md";
  if (!path.posix.extname(normalized)) normalized = path.posix.join(normalized, "README.md");
  return normalized.replace(/^(\.\.\/)+/, "");
}

function isExcludedSource(relativePath) {
  return excludedPrefixes.some((prefix) => relativePath.startsWith(prefix));
}

function isPartnerSource(relativePath) {
  return relativePath.startsWith(partnerPrefix);
}

function routeForSource(relativePath) {
  const noExt = relativePath.replace(/\.md$/i, "");
  const route = noExt.endsWith("/README")
    ? noExt.slice(0, -"/README".length)
    : noExt;

  if (isPartnerSource(relativePath)) return "/partner";
  if (isExcludedSource(relativePath)) {
    return `https://helpdocs.ycloud.com/help-center/${route}`;
  }
  if (relativePath === "README.md") return "/help";
  return `/help/${route}`;
}

function targetPathForSource(relativePath, rootIndex = false) {
  if (rootIndex) return path.join(repoRoot, "index.mdx");
  if (isPartnerSource(relativePath)) return path.join(repoRoot, "partner.mdx");
  if (relativePath === "README.md") return path.join(repoRoot, "help.mdx");
  const noExt = relativePath.replace(/\.md$/i, "");
  const route = noExt.endsWith("/README")
    ? noExt.slice(0, -"/README".length)
    : noExt;
  return path.join(repoRoot, "help", `${route}.mdx`);
}

function safeAssetName(relativePath) {
  const parsed = path.posix.parse(relativePath);
  const hash = crypto.createHash("sha1").update(relativePath).digest("hex").slice(0, 8);
  const base =
    parsed.name
      .normalize("NFKD")
      .replace(/[^\w.-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "") || "asset";
  return `${base}-${hash}${parsed.ext.toLowerCase()}`;
}

function copyAssets() {
  fs.mkdirSync(targetAssets, { recursive: true });
  const usedNames = new Set();
  for (const sourcePath of walk(sourceAssets)) {
    const relativePath = path.relative(sourceAssets, sourcePath).split(path.sep).join("/");
    let targetName = safeAssetName(relativePath);
    let counter = 2;
    while (usedNames.has(targetName)) {
      const parsed = path.posix.parse(targetName);
      targetName = `${parsed.name}-${counter}${parsed.ext}`;
      counter += 1;
    }
    usedNames.add(targetName);
    assetUrlMap.set(relativePath, targetName);
    fs.copyFileSync(sourcePath, path.join(targetAssets, targetName));
  }
}

function decodeHtml(value) {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function getAttr(attrs, name) {
  const match = attrs.match(new RegExp(`${name}=["']([^"']*)["']`, "i"));
  return match ? decodeHtml(match[1]) : "";
}

function stripTags(value) {
  return decodeHtml(value)
    .replace(/<\/?p>/g, "")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .trim();
}

function rewriteAssetUrl(rawUrl) {
  const url = decodeHtml(rawUrl).trim();
  if (/^(https?:)?\/\//i.test(url) || url.startsWith("data:")) return url;
  const marker = ".gitbook/assets/";
  const index = url.indexOf(marker);
  if (index === -1) return url;
  const assetName = url.slice(index + marker.length);
  return `/images/gitbook/${assetUrlMap.get(assetName) ?? safeAssetName(assetName)}`;
}

function imageMarkdown(attrs, caption = "") {
  const src = rewriteAssetUrl(getAttr(attrs, "src"));
  const alt = getAttr(attrs, "alt").replace(/\]/g, "\\]");
  const cleanedCaption = stripTags(caption);
  const image = `![${alt}](${src})`;
  return cleanedCaption ? `${image}\n\n*${cleanedCaption}*` : image;
}

function convertHints(content) {
  return content.replace(
    /\{% hint style="([^"]+)" %\}\s*\n([\s\S]*?)\n\s*\{% endhint %\}/g,
    (_, style, body) => {
      const label =
        {
          info: "Info",
          warning: "Warning",
          danger: "Danger",
          success: "Success",
        }[style] ?? "Note";
      const quoted = body
        .trim()
        .split(/\r?\n/)
        .map((line) => (line.trim() ? `> ${line}` : ">"))
        .join("\n");
      return `> **${label}**\n>\n${quoted}`;
    },
  );
}

function convertEmbeds(content) {
  return content.replace(/\{% embed url="([^"]+)" %\}/g, (_, url) => {
    const decodedUrl = decodeHtml(url);
    return `[Open related resource](${decodedUrl})`;
  });
}

function convertFiles(content) {
  return content.replace(/\{% file src="([^"]+)" %\}/g, (_, src) => {
    const href = rewriteAssetUrl(src);
    const label = path.posix.basename(decodeHtml(src));
    return `[Download ${label}](${href})`;
  });
}

function convertFigures(content) {
  return content
    .replace(/<figure>\s*<img([^>]*)>\s*<figcaption>([\s\S]*?)<\/figcaption>\s*<\/figure>/g, (_, attrs, caption) =>
      imageMarkdown(attrs, caption),
    )
    .replace(/<img([^>]*)>/g, (_, attrs) => imageMarkdown(attrs));
}

function convertContentRefs(content) {
  return content
    .replace(/\{% content-ref [^%]+%\}\s*\n?/g, "")
    .replace(/\{% endcontent-ref %\}\s*\n?/g, "");
}

function rewriteMarkdownImages(content) {
  return content.replace(/!\[([^\]]*)\]\((<[^>]+>|[^)]+)\)/g, (full, alt, rawTarget) => {
    const target = rawTarget.startsWith("<") && rawTarget.endsWith(">")
      ? rawTarget.slice(1, -1)
      : rawTarget;
    const rewritten = rewriteAssetUrl(target);
    return rewritten === target ? full : `![${alt}](${rewritten})`;
  });
}

function convertMarkdownImagesInHtmlTables(content) {
  return content
    .split("\n")
    .map((line) => {
      if (!line.includes("<table")) return line;
      return line
        .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt, src) => {
          return `<img src="${src}" alt="${alt.replace(/"/g, "&quot;")}" />`;
        })
        .replace(/<p>\s*<\/p>/g, "")
        .replace(/<\/p>\s*<p>/g, "<br />")
        .replace(/<\/?p>/g, "")
        .replace(/<ol[^>]*>/g, "")
        .replace(/<\/ol>/g, "")
        .replace(/<ul>/g, "")
        .replace(/<\/ul>/g, "")
        .replace(/<li>/g, "- ")
        .replace(/<\/li>/g, "<br />");
    })
    .join("\n");
}

function rewriteMarkdownLinks(content, fromRel) {
  return content.replace(/(?<!!)\[([^\]]+)\]\(([^)\s]+(?:\s+"[^"]*")?)\)/g, (full, label, target) => {
    const titleMatch = target.match(/^(\S+)(\s+"[^"]*")$/);
    const rawHref = titleMatch ? titleMatch[1] : target;
    const title = titleMatch ? titleMatch[2] : "";
    const href = decodeHtml(rawHref);

    if (brokenRouteMap.has(href)) return `[${label}](${brokenRouteMap.get(href)}${title})`;
    if (/^(https?:|mailto:|tel:|#|\/)/i.test(href)) return full;

    const [pathPart, anchorPart = ""] = href.split("#");
    const normalized = normalizeSourceRel(pathPart, fromRel);
    if (!normalized) return full;

    const route = routeForSource(normalized);
    const anchor = anchorPart ? `#${anchorPart}` : "";
    return `[${label}](${route}${anchor}${title})`;
  });
}

function rewriteHtmlLinks(content, fromRel) {
  return content.replace(/\shref="([^"]+)"/g, (full, rawHref) => {
    const href = decodeHtml(rawHref);
    if (brokenRouteMap.has(href)) return ` href="${brokenRouteMap.get(href)}"`;
    if (/^(https?:|mailto:|tel:|#|\/)/i.test(href)) return full;

    const [pathPart, anchorPart = ""] = href.split("#");
    const normalized = normalizeSourceRel(pathPart, fromRel);
    if (!normalized) return full;

    const route = routeForSource(normalized);
    const anchor = anchorPart ? `#${anchorPart}` : "";
    return ` href="${route}${anchor}"`;
  });
}

function escapeMdxTextExpressions(content) {
  let inFence = false;
  return content
    .split("\n")
    .map((line) => {
      if (/^\s*(```|~~~)/.test(line)) {
        inFence = !inFence;
        return line;
      }
      if (inFence) return line;
      return line
        .replace(/<(?![A-Za-z/!?\-])/g, "&#x3C;")
        .replace(/\\?\{/g, "&#123;")
        .replace(/\\?\}/g, "&#125;");
    })
    .join("\n");
}

function frontmatterBounds(content) {
  if (!content.startsWith("---\n")) return null;
  const end = content.indexOf("\n---", 4);
  if (end === -1) return null;
  const closeEnd = content.indexOf("\n", end + 4);
  return {
    start: 0,
    end: closeEnd === -1 ? content.length : closeEnd + 1,
    body: content.slice(4, end),
    rest: closeEnd === -1 ? "" : content.slice(closeEnd + 1),
  };
}

function yamlString(value) {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function addTitleFrontmatter(content, title) {
  const existing = frontmatterBounds(content);
  if (!existing) return `---\ntitle: ${yamlString(title)}\n---\n\n${content.trimStart()}`;

  const body = existing.body.trimEnd();
  const nextBody = /^title:/m.test(body) ? body : `title: ${yamlString(title)}\n${body}`;
  return `---\n${nextBody}\n---\n\n${existing.rest.trimStart()}`;
}

function convertPage(relativePath, rootIndex = false) {
  const sourcePath = path.join(sourceRoot, relativePath);
  let content = fs.readFileSync(sourcePath, "utf8");
  const title = titleBySource.get(relativePath) ?? titleFromPath(relativePath);

  content = content.replace(/\r\n/g, "\n");
  content = convertHints(content);
  content = convertEmbeds(content);
  content = convertFiles(content);
  content = convertContentRefs(content);
  content = convertFigures(content);
  content = rewriteMarkdownImages(content);
  content = convertMarkdownImagesInHtmlTables(content);
  content = rewriteMarkdownLinks(content, relativePath);
  content = rewriteHtmlLinks(content, relativePath);
  content = content.replace(/<br\s*\/?>/gi, "<br />");
  content = escapeMdxTextExpressions(content);
  content = content.replace(/\n{4,}/g, "\n\n\n");
  content = addTitleFrontmatter(content, rootIndex ? "YCloud Docs" : title);

  const targetPath = targetPathForSource(relativePath, rootIndex);
  ensureDir(targetPath);
  fs.writeFileSync(targetPath, `${content.trimEnd()}\n`);
}

function navPage(relativePath) {
  const route = routeForSource(relativePath).replace(/^\//, "");
  return route || "index";
}

function buildDocsJson(sections) {
  const helpGroups = [];
  let partnerPages = [];

  for (const section of sections) {
    const helpPages = [];
    const currentPartnerPages = [];

    for (const page of section.pages) {
      if (isExcludedSource(page) || page === "SUMMARY.md") continue;
      if (isPartnerSource(page)) {
        currentPartnerPages.push(navPage(page));
      } else {
        helpPages.push(navPage(page));
      }
    }

    if (helpPages.length > 0) {
      helpGroups.push({
        group: section.group,
        pages: helpPages,
      });
    }
    partnerPages = partnerPages.concat(currentPartnerPages);
  }

  const groups = [
    ...helpGroups,
    {
      group: "Partner",
      pages: [...new Set(partnerPages.length > 0 ? partnerPages : ["partner"])],
    },
  ];

  return {
    $schema: "https://mintlify.com/docs.json",
    theme: "almond",
    name: "YCloud Docs",
    description: "YCloud help documentation for WhatsApp marketing, service, sales, and partner workflows.",
    colors: {
      primary: "#166E3F",
      light: "#26BD6C",
      dark: "#166E3F",
    },
    favicon: "/favicon.ico",
    icons: {
      library: "lucide",
    },
    styling: {
      eyebrows: "breadcrumbs",
    },
    contextual: {
      options: ["copy", "view", "assistant"],
    },
    navigation: {
      global: {
        anchors: [
          {
            anchor: "Home",
            icon: "house",
            href: "/",
          },
          {
            anchor: "Help",
            icon: "life-buoy",
            href: "/help",
          },
          {
            anchor: "Partner",
            icon: "handshake",
            href: "/partner",
          },
        ],
      },
      groups,
    },
    logo: {
      light: "/logo/light.svg",
      dark: "/logo/dark.svg",
    },
    navbar: {
      links: [
        {
          label: "YCloud",
          href: "https://www.ycloud.com",
        },
      ],
      primary: {
        type: "button",
        label: "Console",
        href: "https://www.ycloud.com/console/",
      },
    },
    footer: {
      socials: {},
    },
  };
}

if (!fs.existsSync(sourceRoot)) {
  throw new Error(`Missing source directory: ${sourceRoot}`);
}

rmIfExists("analytics");
rmIfExists("integrations");
rmIfExists("platform");
rmIfExists("help");
rmIfExists("partner");
rmIfExists("help.mdx");
rmIfExists("partner.mdx");
rmIfExists("images/gitbook");

fs.mkdirSync(targetAssets, { recursive: true });
copyAssets();

const sections = parseSummary();
const allMarkdown = walk(sourceRoot, (file) => file.endsWith(".md"))
  .map((file) => path.relative(sourceRoot, file).split(path.sep).join("/"))
  .filter((relativePath) => relativePath !== "SUMMARY.md")
  .filter((relativePath) => !isExcludedSource(relativePath));

for (const relativePath of allMarkdown) {
  convertPage(relativePath);
}
convertPage("README.md", true);

const docsJson = buildDocsJson(sections);
fs.writeFileSync(path.join(repoRoot, "docs.json"), `${JSON.stringify(docsJson, null, 2)}\n`);

console.log(`Migrated ${allMarkdown.length} source pages plus root index.`);
console.log(`Copied assets to ${path.relative(repoRoot, targetAssets)}.`);
