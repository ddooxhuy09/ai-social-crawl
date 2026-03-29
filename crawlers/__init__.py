"""
Package chứa các crawler: Pinterest, Instagram, TikTok, Reddit, YouTube.
Backend có thể: from crawlers import crawl_pins_sync, crawl_instagram_sync, ...
"""
from crawlers.pinterest import crawl_pins_sync, upload_pin, upload_pin_sync
from crawlers.instagram_crawler import crawl_instagram_sync, crawl_instagram_all_sync
from crawlers.tiktok_crawler import crawl_tiktok_sync
from crawlers.reddit_crawler import crawl_reddit_sync
from crawlers.youtube_crawler import crawl_youtube_sync

__all__ = [
    "crawl_pins_sync",
    "upload_pin",
    "upload_pin_sync",
    "crawl_instagram_sync",
    "crawl_instagram_all_sync",
    "crawl_tiktok_sync",
    "crawl_reddit_sync",
    "crawl_youtube_sync",
]

