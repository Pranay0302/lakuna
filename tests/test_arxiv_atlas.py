import json

from ingestion import arxiv_atlas


SAMPLE_FEED = b"""<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:arxiv="http://arxiv.org/schemas/atom">
  <entry>
    <id>http://arxiv.org/abs/2607.00001v1</id>
    <updated>2026-07-17T12:00:00Z</updated>
    <published>2026-07-17T12:00:00Z</published>
    <title> Efficient Atlas Learning for Research Graphs </title>
    <summary> We study compact research graph ingestion. </summary>
    <author><name>Ada Lovelace</name></author>
    <author><name>Grace Hopper</name></author>
    <arxiv:primary_category term="cs.CV" />
    <category term="cs.CV" />
    <category term="cs.AI" />
    <link href="http://arxiv.org/abs/2607.00001v1" rel="alternate" type="text/html" />
    <link title="pdf" href="http://arxiv.org/pdf/2607.00001v1" rel="related" type="application/pdf" />
  </entry>
</feed>
"""


class FakeResponse:
    def __init__(self, payload):
        self.payload = payload

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def read(self):
        return self.payload


def test_parse_arxiv_feed_normalizes_records():
    records = arxiv_atlas.parse_arxiv_feed(SAMPLE_FEED)

    assert records == [
        {
            "id": "2607.00001v1",
            "arxiv_id": "2607.00001v1",
            "title": "Efficient Atlas Learning for Research Graphs",
            "summary": "We study compact research graph ingestion.",
            "authors": ["Ada Lovelace", "Grace Hopper"],
            "published": "2026-07-17T12:00:00Z",
            "updated": "2026-07-17T12:00:00Z",
            "categories": ["cs.CV", "cs.AI"],
            "primary_category": "cs.CV",
            "abs_url": "http://arxiv.org/abs/2607.00001v1",
            "pdf_url": "http://arxiv.org/pdf/2607.00001v1",
            "source": "arxiv",
            "atlas_dataset": "arxiv_atlas",
            "ingested_at": records[0]["ingested_at"],
        }
    ]


def test_export_current_atlas_writes_jsonl_batches(tmp_path):
    seen_urls = []

    def fake_open(url, timeout):
        seen_urls.append(url)
        return FakeResponse(SAMPLE_FEED)

    export = arxiv_atlas.export_current_atlas(
        output_dir=tmp_path,
        max_results=1,
        batch_size=1,
        sleep_seconds=0,
        opener=fake_open,
    )

    assert len(export.records) == 1
    assert len(export.batch_files) == 1
    assert "sortBy=submittedDate" in seen_urls[0]
    assert "search_query=cat%3Acs.CV" in seen_urls[0]
    lines = export.batch_files[0].read_text().splitlines()
    assert len(lines) == 1
    assert json.loads(lines[0])["arxiv_id"] == "2607.00001v1"


def test_build_category_query_supports_multiple_categories():
    assert arxiv_atlas.build_category_query(["cs.CV", "cs.AI"]) == "cat:cs.CV OR cat:cs.AI"
