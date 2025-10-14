import os
import sys
import time
import json
import argparse
from datetime import datetime, timezone
from typing import List, Dict, Optional

import requests

try:
    # optional convenience for local envs
    from dotenv import load_dotenv  # type: ignore
    # load project-root .env
    load_dotenv(os.path.join(os.path.dirname(__file__), "..", "..", "..", "..", "..", ".env"))
except Exception:
    pass


def get_auth_header() -> str:
    """Resolve token from env and return Authorization header value.
    Adds "Bot " prefix if missing, since Discord bot tokens require it.
    """
    token = os.getenv("DISCORD_TOKEN")
    if not token:
        raise RuntimeError("DISCORD_TOKEN is not set in environment")
    token = token.strip()
    # Accept pre-prefixed tokens ("Bot ", "Bearer ")
    if token.lower().startswith("bot ") or token.lower().startswith("bearer "):
        return token
    return f"Bot {token}"


def parse_iso(ts: str) -> Optional[datetime]:
    try:
        # Discord returns ISO UTC (e.g., 2025-01-01T12:34:56.789000+00:00)
        return datetime.fromisoformat(ts.replace("Z", "+00:00"))
    except Exception:
        return None


def fetch_messages(channel_id: str, since_dt: Optional[datetime], limit_per_page: int = 100, max_pages: int = 1000) -> List[Dict]:
    """Paginate backwards using 'before' param and stop once messages fall before since_dt."""
    headers = {"Authorization": get_auth_header(), "User-Agent": "clarm-scrape/1.0"}
    base = f"https://discord.com/api/v9/channels/{channel_id}/messages"
    params: Dict[str, str] = {"limit": str(min(max(limit_per_page, 1), 100))}
    last_message_id: Optional[str] = None
    collected: List[Dict] = []

    def build_avatar_url(author: Dict) -> str:
        """Return the best-effort avatar URL for a Discord user.
        Uses CDN avatars when available; otherwise falls back to a default avatar sprite.
        """
        user_id = (author or {}).get("id")
        avatar = (author or {}).get("avatar")
        if user_id and avatar:
            ext = "gif" if isinstance(avatar, str) and avatar.startswith("a_") else "png"
            return f"https://cdn.discordapp.com/avatars/{user_id}/{avatar}.{ext}?size=80"
        # Fallback default avatar index
        discriminator = (author or {}).get("discriminator")
        try:
            idx = int(discriminator) % 5 if discriminator is not None else 0
        except Exception:
            idx = 0
        return f"https://cdn.discordapp.com/embed/avatars/{idx}.png"

    for _ in range(max_pages):
        qp = params.copy()
        if last_message_id:
            qp["before"] = last_message_id

        r = requests.get(base, headers=headers, params=qp)
        if r.status_code == 429:
            try:
                retry = r.json().get("retry_after", 1)
            except Exception:
                retry = 1
            time.sleep(float(retry) + 0.1)
            continue
        if r.status_code == 403:
            raise RuntimeError("Forbidden: token lacks access to this channel")
        if r.status_code == 401:
            raise RuntimeError("Unauthorized: invalid token")
        r.raise_for_status()

        batch = r.json()
        if not isinstance(batch, list) or len(batch) == 0:
            break

        stop = False
        for msg in batch:
            ts = parse_iso(msg.get("timestamp", ""))
            if since_dt and ts is not None and ts < since_dt:
                stop = True
                break
            author_obj = (msg.get("author") or {})
            collected.append({
                "message_id": msg.get("id"),
                "author": author_obj.get("username"),  # preserved for backward compatibility
                "author_id": author_obj.get("id"),
                "author_display_name": author_obj.get("global_name") or author_obj.get("display_name") or author_obj.get("username"),
                "author_avatar_url": build_avatar_url(author_obj),
                "timestamp": msg.get("timestamp"),
                "text": msg.get("content", ""),
                "attachments": [a.get("url") for a in msg.get("attachments", []) if a.get("url")],
            })

        last_message_id = batch[-1]["id"]
        if stop:
            break

        # Gentle pacing to be nice
        time.sleep(0.2)

    return collected


def main() -> int:
    parser = argparse.ArgumentParser(description="Fetch Discord messages via REST API")
    parser.add_argument("--channel-id", required=True)
    parser.add_argument("--since", default="today", help="YYYY-MM-DD or 'today'")
    parser.add_argument("--out-json", required=True)
    args = parser.parse_args()

    # Compute cutoff (local midnight today by default) in UTC-aware
    since_dt: Optional[datetime] = None
    if args.since:
        if args.since.lower() == "today":
            now = datetime.now()
            since_dt = datetime(now.year, now.month, now.day, tzinfo=timezone.utc)
        else:
            dt = datetime.strptime(args.since, "%Y-%m-%d")
            since_dt = datetime(dt.year, dt.month, dt.day, tzinfo=timezone.utc)

    msgs = fetch_messages(args.channel_id, since_dt=since_dt)

    os.makedirs(os.path.dirname(args.out_json) or ".", exist_ok=True)
    with open(args.out_json, "w", encoding="utf-8") as f:
        json.dump(msgs, f, ensure_ascii=False)
    print(f"Saved {len(msgs)} messages -> {args.out_json}")
    return 0


if __name__ == "__main__":
    sys.exit(main())


