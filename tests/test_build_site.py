import json
import re
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
import build_site  # noqa: E402


class SiteTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        base = Path(self.tmp.name)
        self.public = base / "public"
        self.public.mkdir()
        for name in ("index.html", "_headers"):
            shutil.copyfile(build_site.PUBLIC / name, self.public / name)
        self.site = base / "site.json"
        self.site.write_text(json.dumps({"SITE_URL": "https://trains.example.pages.dev/"}), encoding="utf-8")

    def tearDown(self):
        self.tmp.cleanup()

    def test_published_files_are_up_to_date(self):
        """Fails if data/site.json or the JSON-LD changed without running build_data.py / start.bat."""
        url = build_site.load_site_url()
        index = build_site.read(build_site.PUBLIC / "index.html")
        self.assertIn(f'<meta property="og:url" content="{url}/">', index)
        self.assertIn(f'<meta property="og:image" content="{url}/assets/og-image.png">', index)
        self.assertIn(f"Sitemap: {url}/sitemap.xml", (build_site.PUBLIC / "robots.txt").read_text(encoding="utf-8"))
        self.assertIn(f"<loc>{url}/</loc>", (build_site.PUBLIC / "sitemap.xml").read_text(encoding="utf-8"))
        digest = build_site.csp_hash(build_site.LD_RE.search(index).group(1))
        for text in (index, build_site.read(build_site.PUBLIC / "_headers")):
            self.assertIn(f"script-src 'self' '{digest}' https://static.cloudflareinsights.com;", text)
        self.assertTrue((build_site.PUBLIC / "assets" / "og-image.png").is_file())

    def test_new_url_is_written_everywhere_and_rerun_changes_nothing(self):
        url, changed = build_site.build_site(self.public, self.site)
        self.assertEqual(url, "https://trains.example.pages.dev")
        self.assertEqual(sorted(p.name for p in changed), ["_headers", "index.html", "robots.txt", "sitemap.xml"])
        index = build_site.read(self.public / "index.html")
        self.assertNotIn("REPLACE-ME", index)
        self.assertEqual(index.count("https://trains.example.pages.dev/"), 6)
        ld = json.loads(build_site.LD_RE.search(index).group(1))
        self.assertEqual(ld["url"], "https://trains.example.pages.dev/")
        self.assertEqual(ld["author"]["sameAs"], build_site.AUTHOR_LINKS)
        self.assertEqual(build_site.build_site(self.public, self.site)[1], [])

    def test_hash_matches_script_bytes(self):
        build_site.build_site(self.public, self.site)
        index = build_site.read(self.public / "index.html")
        script = build_site.LD_RE.search(index).group(1)
        self.assertNotIn("\n", script, "JSON-LD stays on one line so line-ending changes cannot break the hash")
        hashes = re.findall(r"'(sha256-[^']+)'", index)
        self.assertEqual(hashes, [build_site.csp_hash(script)])

    def test_bad_url_fails(self):
        for bad in ("http://insecure.example", "trains.example", "https://x.example/\"><script>", 42):
            self.site.write_text(json.dumps({"SITE_URL": bad}), encoding="utf-8")
            with self.assertRaises(build_site.SiteError):
                build_site.build_site(self.public, self.site)


if __name__ == "__main__":
    unittest.main()
