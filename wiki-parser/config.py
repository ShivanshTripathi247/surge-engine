import os
import multiprocessing

try:
    from dotenv import load_dotenv
    load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))
except ImportError:
    pass

DB_HOST = os.environ.get("SURGE_DB_HOST", "192.168.1.21")
DB_PORT = int(os.environ.get("SURGE_DB_PORT", "5432"))
DB_NAME = os.environ.get("SURGE_DB_NAME", "surge_wiki")
DB_USER = os.environ.get("SURGE_DB_USER", "surge_admin")
DB_PASSWORD = os.environ.get("SURGE_DB_PASSWORD", "")

DUMP_PATH = os.environ.get(
    "SURGE_DUMP_PATH",
    "/mnt/data/downloads/enwiki-20260401-pages-articles-multistream.xml.bz2",
)
INDEX_PATH = os.environ.get(
    "SURGE_INDEX_PATH",
    "/mnt/data/downloads/enwiki-20260401-pages-articles-multistream-index.txt.bz2",
)

BATCH_SIZE_DOCS = 500
BATCH_SIZE_LINKS = 5000
MIN_CONTENT_LENGTH = 200
NUM_WORKERS = 8
LOG_FILE = "wiki-parser/parser.log"

WIKI_URL_PREFIX = "https://en.wikipedia.org/wiki/"

EXCLUDED_LINK_NAMESPACES = (
    "File:", "Category:", "Wikipedia:", "Template:", "Help:", "Portal:",
    "Talk:", "User:", "Draft:", "MOS:", "TimedText:", "Module:",
    "Special:", "Media:",
    "file:", "category:", "wikipedia:", "template:", "help:", "portal:",
    "talk:", "user:", "draft:", "mos:", "timedtext:", "module:",
    "special:", "media:",
)
