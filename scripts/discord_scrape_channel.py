#!/usr/bin/env python3
"""
Discord Web Scraper (Playwright)

This script uses a real Chromium session to open a Discord channel URL and extract
messages into structured JSON and a simple HTML report.

Usage examples:

  1) First-time login (interactive, saves a storage state for reuse):
     python scripts/discord_scrape_channel.py \
       --channel-id 1288403910284935182 \
       --guess-url \
       --storage-state .cache/discord_storage.json \
       --interactive-login

     A browser window will open. Log in to Discord, navigate completes automatically.
     Once the main app loads, the storage state is saved for future runs.

  2) Headless scrape (after storage state is saved):
     python scripts/discord_scrape_channel.py \
       --channel-id 1288403910284935182 \
       --guess-url \
       --storage-state .cache/discord_storage.json \
       --out-json static/diagrams/discord-1288403910284935182.json \
       --out-html static/diagrams/discord-1288403910284935182_scrape.html \
       --max-scrolls 80

Notes:
- If you know the guild ID, pass --guild-id to construct the precise URL
  (https://discord.com/channels/<guildId>/<channelId>). If you omit it, --guess-url
  will attempt both server and DM URL shapes.
- This scraper reads the rendered DOM. Discord may change CSS/attributes at any time.
  If selectors break, adjust the extraction logic below.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from dataclasses import dataclass, asdict
from typing import List, Optional
from datetime import datetime, timedelta

from playwright.sync_api import Playwright, sync_playwright, TimeoutError as PlaywrightTimeoutError


DEFAULT_STORAGE_STATE = ".cache/discord_storage.json"


@dataclass
class ScrapedMessage:
    message_id: Optional[str]
    author: Optional[str]
    timestamp: Optional[str]
    text: str
    attachments: List[str]


def build_channel_urls(channel_id: str, guild_id: Optional[str], guess: bool) -> List[str]:
    urls: List[str] = []
    base = "https://discord.com/channels"
    if guild_id:
        urls.append(f"{base}/{guild_id}/{channel_id}")
    if guess:
        # Try server channel guess with placeholder guild (often works if resolved by client)
        if not guild_id:
            urls.append(f"{base}/0/{channel_id}")
        # Try DM/Group DM shape
        urls.append(f"{base}/@me/{channel_id}")
    # De-duplicate preserving order
    dedup: List[str] = []
    seen = set()
    for u in urls:
        if u not in seen:
            dedup.append(u)
            seen.add(u)
    return dedup


def wait_for_discord_loaded(page, timeout_ms: int = 60000) -> None:
    # Heuristics that the Discord app UI is mounted
    selectors = [
        "ol[data-list-id='chat-messages']",
        "[data-list-id='chat-messages']",
        "div[role='textbox']",
        "nav[aria-label*='Servers']",
    ]
    last_error = None
    for sel in selectors:
        try:
            page.wait_for_selector(sel, timeout=timeout_ms)
            return
        except PlaywrightTimeoutError as e:
            last_error = e
    if last_error:
        raise last_error


def scroll_up_from_bottom(page, max_scrolls: int) -> None:
    """Scroll upwards starting from the bottom (latest messages)."""
    # Jump to bottom first
    try:
        page.keyboard.press("End")
    except Exception:
        pass
    page.wait_for_timeout(250)

    for _ in range(max_scrolls):
        try:
            page.keyboard.press("PageUp")
        except Exception:
            pass
        page.wait_for_timeout(200)


def extract_messages(page) -> List[ScrapedMessage]:
    # The DOM structure changes; use multiple strategies.
    messages: List[ScrapedMessage] = []

    # Prefer Discord's chat list structure
    parent = page.locator("ol[data-list-id='chat-messages']")
    items = (
        parent.locator("li[data-list-item-id^='chat-messages'], li[id^='chat-messages-']")
        if parent.count() > 0
        else page.locator(
            "li[data-list-item-id^='chat-messages'], li[id^='chat-messages-'], article[class*='message-']"
        )
    )
    count = items.count()
    for i in range(count):
        item = items.nth(i)
        try:
            # Message id often present on a nested element
            message_id = None
            try:
                el = item.locator("[id^='chat-messages-'], [data-list-item-id^='chat-messages']").first
                if el.count() > 0:
                    message_id = el.get_attribute("id") or el.get_attribute("data-list-item-id")
            except Exception:
                pass

            # Header usually contains author and timestamp in a <h3> or similar
            author = None
            timestamp = None
            try:
                # Prefer username anchors and aria labels to avoid extra badges/newlines
                header = item.locator("h3, header h3, header time, [class*='headerText']").first
                if header.count() > 0:
                    header_text = header.inner_text().strip()
                    # Heuristic split "Author — Today at 1:23 PM"
                    if "\u2014" in header_text:
                        parts = [p.strip() for p in header_text.split("\u2014", 1)]
                        if parts:
                            author = parts[0] or None
                        if len(parts) > 1:
                            timestamp = parts[1] or None
                    else:
                        # Fallback: author only
                        author = header_text or None

                # Additional selector: explicit username span/anchor
                if not author:
                    user_node = item.locator("a[role='button'][href*='/users/'], span[class*='username']").first
                    if user_node.count() > 0:
                        author = (user_node.inner_text() or "").strip()

                # Try ISO timestamp from <time datetime="...">
                if not timestamp:
                    tnode = item.locator("time[datetime]").first
                    if tnode.count() > 0:
                        iso = tnode.get_attribute("datetime")
                        if iso:
                            timestamp = iso

                # Normalize author to single line without extra spaces/badges
                if author:
                    author = author.split("\n")[0]
                    author = " ".join(author.split())
            except Exception:
                pass

            # Message text container (several possible selectors)
            text_candidates = [
                "div[id^='message-content-']",
                "div[class*='messageContent']",
                "div[data-slate-node='element']",
                "[class*='markup']",  # general text blocks
                "article[class*='message-'] [class*='markup']",
            ]
            text_value = ""
            for sel in text_candidates:
                locator = item.locator(sel)
                if locator.count() > 0:
                    # Join multiple blocks
                    parts: List[str] = []
                    for j in range(min(locator.count(), 10)):
                        parts.append(locator.nth(j).inner_text().strip())
                    text_value = "\n".join([p for p in parts if p])
                    if text_value:
                        break

            # Attachments/links
            attachments: List[str] = []
            try:
                links = item.locator("a[href]")
                for j in range(min(links.count(), 25)):
                    href = links.nth(j).get_attribute("href")
                    if href and href.startswith("http"):
                        attachments.append(href)
            except Exception:
                pass

            # Skip empty
            if not text_value and not attachments:
                continue

            messages.append(
                ScrapedMessage(
                    message_id=message_id,
                    author=author,
                    timestamp=timestamp,
                    text=text_value,
                    attachments=attachments,
                )
            )
        except Exception:
            # Ignore individual extraction failures
            continue

    return messages


def ensure_messages_visible(page, tries: int = 12) -> None:
    # Nudge the UI to load some messages by jumping to bottom and tiny upward scroll
    for _ in range(tries):
        try:
            page.keyboard.press("End")
        except Exception:
            pass
        page.wait_for_timeout(200)
        try:
            page.evaluate(
                """
                () => {
                  const ol = document.querySelector("ol[data-list-id='chat-messages']");
                  if (ol && ol.parentElement) {
                    const scroller = ol.parentElement;
                    scroller.scrollTop = scroller.scrollHeight;
                  }
                }
                """
            )
        except Exception:
            pass
        page.wait_for_timeout(250)
        # If any message-like element is present, stop early
        if page.locator("li[id^='chat-messages-'], li[data-list-item-id^='chat-messages'], article[class*='message-']").count() > 0:
            return


def render_html(messages: List[ScrapedMessage]) -> str:
    def esc(s: str) -> str:
        return (
            s.replace("&", "&amp;")
            .replace("<", "&lt;")
            .replace(">", "&gt;")
            .replace("\n", "<br>")
        )

    rows = []
    for m in messages:
        header = f"<strong>{esc(m.author or 'Unknown')}</strong>"
        if m.timestamp:
            header += f" <span style=\"color:#888\">{esc(m.timestamp)}</span>"
        body = esc(m.text)
        if m.attachments:
            att_html = "".join(
                f"<div><a href=\"{esc(url)}\" target=\"_blank\">{esc(url)}</a></div>" for url in m.attachments
            )
        else:
            att_html = ""
        rows.append(f"<div style=\"margin:12px 0;\">{header}<div>{body}</div>{att_html}</div>")

    return (
        "<!doctype html><html><head><meta charset='utf-8'>"
        "<meta name='viewport' content='width=device-width, initial-scale=1'>"
        "<title>Discord Channel Export</title>"
        "<style>body{font-family:-apple-system,system-ui,Segoe UI,Roboto,Inter,Arial,sans-serif;padding:24px;max-width:900px;margin:auto;background:#0f1115;color:#f1f1f1;}a{color:#9cdcfe}</style>"
        "</head><body>"
        + "".join(rows)
        + "</body></html>"
    )


def main() -> int:
    parser = argparse.ArgumentParser(description="Scrape a Discord channel via the web client")
    parser.add_argument("--channel-id", required=True, help="Discord channel ID to scrape")
    parser.add_argument("--guild-id", help="Guild ID (if known). If omitted, use --guess-url")
    parser.add_argument("--guess-url", action="store_true", help="Try both server and DM URL shapes")
    parser.add_argument("--storage-state", default=DEFAULT_STORAGE_STATE, help="Path to storage state JSON for authenticated session")
    parser.add_argument("--interactive-login", action="store_true", help="Open a headed browser to allow manual login and save storage state")
    parser.add_argument("--headless", action="store_true", help="Run headless (requires existing storage state)")
    parser.add_argument("--out-json", default=None, help="Path to write JSON export")
    parser.add_argument("--out-html", default=None, help="Path to write HTML export")
    parser.add_argument("--max-scrolls", type=int, default=1500, help="Number of scroll attempts towards the top")
    parser.add_argument("--since", default="today", help="Only include messages at or after this local date (YYYY-MM-DD or 'today').")

    args = parser.parse_args()

    urls = build_channel_urls(args.channel_id, args.guild_id, args.guess_url or not args.guild_id)
    os.makedirs(os.path.dirname(args.storage_state) or ".", exist_ok=True)

    with sync_playwright() as p:
        browser_type = p.chromium
        headless = args.headless and not args.interactive_login

        context_kwargs = {}
        if os.path.exists(args.storage_state):
            context_kwargs["storage_state"] = args.storage_state

        browser = browser_type.launch(headless=headless)
        context = browser.new_context(**context_kwargs)
        page = context.new_page()

        try:
            if args.interactive_login and not os.path.exists(args.storage_state):
                page.goto("https://discord.com/login", wait_until="domcontentloaded")
                print("Opened Discord login. Please complete login in the browser window…", file=sys.stderr)
                # Wait for app mount
                try:
                    wait_for_discord_loaded(page, timeout_ms=120000)
                except PlaywrightTimeoutError:
                    # Give the user more time if needed
                    page.wait_for_timeout(60000)
                context.storage_state(path=args.storage_state)
                print(f"Saved storage state to {args.storage_state}", file=sys.stderr)

            # Navigate to the first URL that successfully loads messages
            loaded = False
            for url in urls:
                page.goto(url, wait_until="domcontentloaded")
                try:
                    wait_for_discord_loaded(page, timeout_ms=45000)
                    loaded = True
                    break
                except PlaywrightTimeoutError:
                    continue

            if not loaded:
                print("Failed to load the Discord app or channel. Ensure you are logged in.", file=sys.stderr)
                return 2

            ensure_messages_visible(page, tries=8)
            # New behavior: collect latest by scrolling up from bottom
            scroll_up_from_bottom(page, max_scrolls=args.max_scrolls)
            scraped = extract_messages(page)

            # Filter by --since
            cutoff = None
            if args.since:
                if args.since.lower() == "today":
                    now = datetime.now()
                    cutoff = datetime(now.year, now.month, now.day)
                else:
                    try:
                        cutoff = datetime.strptime(args.since, "%Y-%m-%d")
                    except Exception:
                        cutoff = None
            if cutoff is not None:
                filtered: List[ScrapedMessage] = []
                for m in scraped:
                    ts = m.timestamp or ""
                    keep = False
                    # ISO datetime preferred
                    try:
                        dt = datetime.fromisoformat(ts.replace("Z", "+00:00")).astimezone().replace(tzinfo=None)
                        if dt >= cutoff:
                            keep = True
                    except Exception:
                        if "Today" in ts:
                            keep = True
                        elif "Yesterday" in ts:
                            y = datetime.now() - timedelta(days=1)
                            keep = y >= cutoff
                    if keep:
                        filtered.append(m)
                scraped = filtered

            if args.out_json:
                os.makedirs(os.path.dirname(args.out_json) or ".", exist_ok=True)
                with open(args.out_json, "w", encoding="utf-8") as f:
                    json.dump([asdict(m) for m in scraped], f, ensure_ascii=False, indent=2)
                print(f"Wrote JSON: {args.out_json}")

            if args.out_html:
                os.makedirs(os.path.dirname(args.out_html) or ".", exist_ok=True)
                html = render_html(scraped)
                with open(args.out_html, "w", encoding="utf-8") as f:
                    f.write(html)
                print(f"Wrote HTML: {args.out_html}")

            return 0
        finally:
            context.close()
            browser.close()


if __name__ == "__main__":
    sys.exit(main())


