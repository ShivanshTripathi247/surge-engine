import re
import urllib.parse
import config

_LINK_RE = re.compile(r"\[\[([^|\]#][^|\]]*?)(?:\|[^\]]*?)?\]\]")


def title_to_url(title: str) -> str:
    t = title.strip()
    if not t:
        return ""
    t = t.replace(" ", "_")
    t = t[0].upper() + t[1:]
    return config.WIKI_URL_PREFIX + urllib.parse.quote(t, safe="_/():,.'-&%!~*")


def extract_links(wikitext: str):
    if not wikitext:
        return []
    seen = set()
    out = []
    for m in _LINK_RE.finditer(wikitext):
        target = m.group(1).strip()
        if not target or target.startswith("#"):
            continue
        if "#" in target:
            target = target.split("#", 1)[0].strip()
            if not target:
                continue
        if target.startswith(config.EXCLUDED_LINK_NAMESPACES):
            continue
        if target.startswith(":"):
            target = target[1:].strip()
            if not target or target.startswith(config.EXCLUDED_LINK_NAMESPACES):
                continue
        url = title_to_url(target)
        if url and url not in seen:
            seen.add(url)
            out.append(url)
    return out
