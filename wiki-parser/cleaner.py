import html
import re
import wikitextparser as wtp

_REF_RE = re.compile(r"<ref\b[^>]*?/>|<ref\b[^>]*?>.*?</ref>", re.IGNORECASE | re.DOTALL)
_TAG_RE = re.compile(
    r"<(gallery|math|score|timeline|syntaxhighlight|source|nowiki|pre)\b[^>]*?>.*?</\1>",
    re.IGNORECASE | re.DOTALL,
)
_TABLE_RE = re.compile(r"\{\|.*?\|\}", re.DOTALL)
_HEADING_RE = re.compile(r"^\s*={2,6}\s*(.*?)\s*={2,6}\s*$", re.MULTILINE)
_EXTLINK_RE = re.compile(r"\[(?:https?|ftp)://[^\s\]]+\s+([^\]]+)\]")
_EXTLINK_BARE_RE = re.compile(r"\[(?:https?|ftp)://[^\s\]]+\]")
_BOLD_ITALIC_RE = re.compile(r"'{2,5}")
_WS_RE = re.compile(r"\s+")
_COMMENT_RE = re.compile(r"<!--.*?-->", re.DOTALL)


def _strip_templates(text: str) -> str:
    out = []
    depth = 0
    i = 0
    n = len(text)
    while i < n:
        if i + 1 < n and text[i] == "{" and text[i + 1] == "{":
            depth += 1
            i += 2
            continue
        if i + 1 < n and text[i] == "}" and text[i + 1] == "}" and depth > 0:
            depth -= 1
            i += 2
            continue
        if depth == 0:
            out.append(text[i])
        i += 1
    return "".join(out)


def _strip_wikilinks(text: str) -> str:
    def repl(m):
        inner = m.group(1)
        if "|" in inner:
            return inner.split("|", 1)[1]
        return inner

    prev = None
    cur = text
    pattern = re.compile(r"\[\[([^\[\]]+)\]\]")
    while prev != cur:
        prev = cur
        cur = pattern.sub(repl, cur)
    return cur


def clean(wikitext: str) -> str:
    if not wikitext:
        return ""

    text = html.unescape(wikitext)
    text = _COMMENT_RE.sub(" ", text)
    text = _REF_RE.sub(" ", text)
    text = _TAG_RE.sub(" ", text)
    text = _strip_templates(text)
    text = _TABLE_RE.sub(" ", text)

    if len(text) > 3000:
        try:
            text = wtp.parse(text).plain_text()
        except Exception:
            text = _strip_wikilinks(text)
    else:
        text = _strip_wikilinks(text)

    text = _EXTLINK_RE.sub(r"\1", text)
    text = _EXTLINK_BARE_RE.sub(" ", text)
    text = _HEADING_RE.sub(r"\1", text)
    text = _BOLD_ITALIC_RE.sub("", text)
    text = _WS_RE.sub(" ", text).strip()
    return text
