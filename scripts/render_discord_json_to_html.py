#!/usr/bin/env python3
"""
Render Discord messages JSON (from discord_fetch_via_api.py) to a lightweight HTML page.

Input JSON array items can include:
- message_id, timestamp, text
- author, author_id, author_display_name, author_avatar_url
- attachments: [urls]

Usage:
  python scripts/render_discord_json_to_html.py \
    --in static/diagrams/discord-1288403910284935182.json \
    --out static/diagrams/discord-1288403910284935182.html
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from html import escape


def render_html(messages: list[dict]) -> str:
    def msg_block(m: dict) -> str:
        avatar = escape(m.get("author_avatar_url") or "")
        display = escape(m.get("author_display_name") or m.get("author") or "")
        ts = escape(m.get("timestamp") or "")
        text = escape(m.get("text") or "")
        atts = m.get("attachments") or []
        atts_html = "".join(
            f'<div class="att"><a href="{escape(u)}" target="_blank" rel="noreferrer">{escape(u)}</a></div>'
            for u in atts
        )
        avatar_tag = (
            f'<img class="avatar" src="{avatar}" alt="avatar" loading="lazy" />' if avatar else ""
        )
        return (
            "<div class=\"msg\">"
            f"{avatar_tag}"
            f"<div class=\"meta\"><div class=\"author\">{display}</div><div class=\"ts\">{ts}</div></div>"
            f"<div class=\"text\">{text}</div>"
            f"<div class=\"atts\">{atts_html}</div>"
            "</div>"
        )

    style = """
    body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; margin: 0; padding: 0; background: #0b0f19; color: #eef1f6; }
    .wrap { max-width: 980px; margin: 0 auto; padding: 24px; }
    .msg { display: grid; grid-template-columns: 44px 1fr; gap: 8px 12px; padding: 12px 8px; border-bottom: 1px solid #1a2335; }
    .avatar { width: 44px; height: 44px; border-radius: 50%; background: #111827; }
    .meta { display: flex; align-items: baseline; gap: 12px; }
    .author { font-weight: 600; }
    .ts { font-size: 12px; color: #93a3b8; }
    .text { grid-column: 2; white-space: pre-wrap; word-wrap: break-word; }
    .atts { grid-column: 2; margin-top: 6px; }
    .att a { color: #60a5fa; text-decoration: none; }
    .att a:hover { text-decoration: underline; }
    """

    body = "".join(msg_block(m) for m in messages)
    html = (
        "<!DOCTYPE html><html><head><meta charset=\"utf-8\" />"
        "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\" />"
        f"<style>{style}</style>"
        "<title>Discord Export</title></head><body><div class=\"wrap\">"
        f"{body}"
        "</div></body></html>"
    )
    return html


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="in_path", required=True)
    ap.add_argument("--out", dest="out_path", required=True)
    args = ap.parse_args()

    with open(args.in_path, "r", encoding="utf-8") as f:
        msgs = json.load(f)
        if not isinstance(msgs, list):
            print("Input JSON must be a list of messages", file=sys.stderr)
            return 2

    html = render_html(msgs)
    os.makedirs(os.path.dirname(args.out_path) or ".", exist_ok=True)
    with open(args.out_path, "w", encoding="utf-8") as f:
        f.write(html)
    print(f"Wrote HTML -> {args.out_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())


