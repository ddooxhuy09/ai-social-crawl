import requests
import json
import csv
import random
import time
from pathlib import Path
from typing import Dict, List, Optional
import os
from datetime import datetime

# Thư mục gốc project (cha của crawlers/) - dùng cho api.json, CSV
_BASE_DIR = Path(__file__).resolve().parent.parent


class YouTubeViewCrawler:
    def __init__(self):
        self.base_url = "https://www.googleapis.com/youtube/v3"
        self.api_keys = self.load_api_keys()
        self.current_api_index = 0
        
    def load_api_keys(self) -> List[Dict]:
        """Load API key từ biến môi trường YOUTUBE_API_KEY."""
        api_key = os.getenv("YOUTUBE_API_KEY", "")
        if not api_key:
            raise Exception("YOUTUBE_API_KEY chưa được cấu hình trong file .env")
        return [{"api": api_key, "status": True}]
    
    def get_next_api_key(self) -> str:
        """Get next available API key"""
        if not self.api_keys:
            raise Exception("Không còn API key nào khả dụng")
        
        api_key = self.api_keys[self.current_api_index]['api']
        print(f"Sử dụng API key {self.current_api_index + 1}/{len(self.api_keys)}")
        return api_key
    
    def mark_api_as_failed(self):
        """Mark current API key as failed (in-memory only, env var cannot be updated at runtime)."""
        if not self.api_keys:
            return
        self.api_keys[self.current_api_index]['status'] = False
        print(f"API key {self.current_api_index + 1} đánh dấu là failed (quota exceeded)")
    
    def switch_to_next_api(self):
        """Switch to next available API key"""
        self.current_api_index += 1
        
        # If we've used all APIs, reset to beginning and filter out failed ones
        if self.current_api_index >= len(self.api_keys):
            # Reload API keys to get updated status
            self.api_keys = self.load_api_keys()
            self.current_api_index = 0
            
            if not self.api_keys:
                raise Exception("Tất cả API keys đều đã bị lỗi")
        
        print(f"Chuyển sang API key {self.current_api_index + 1}")
    
    def make_api_request(self, endpoint: str, params: Dict) -> Dict:
        """Make API request with automatic API key rotation on failure"""
        max_retries = len(self.api_keys)
        retry_count = 0
        
        while retry_count < max_retries:
            try:
                api_key = self.get_next_api_key()
                params["key"] = api_key
                time.sleep(random.uniform(0.2, 0.8))
                print(f"Đang gửi request với API key {self.current_api_index + 1}...")
                response = requests.get(endpoint, params=params)
                
                # Check if request was successful
                if response.status_code == 200:
                    return response.json()
                elif response.status_code == 403:
                    # API quota exceeded or invalid
                    print(f"API key {self.current_api_index + 1} bị lỗi 403 (quota exceeded/invalid)")
                    self.mark_api_as_failed()
                    self.switch_to_next_api()
                elif response.status_code == 400:
                    # Bad request - might be API key issue
                    print(f"API key {self.current_api_index + 1} bị lỗi 400 (bad request)")
                    self.mark_api_as_failed()
                    self.switch_to_next_api()
                else:
                    # Other HTTP errors
                    print(f"HTTP error {response.status_code}: {response.text}")
                    self.mark_api_as_failed()
                    self.switch_to_next_api()
                
                retry_count += 1
                
            except requests.exceptions.RequestException as e:
                print(f"Network error với API key {self.current_api_index + 1}: {e}")
                self.mark_api_as_failed()
                self.switch_to_next_api()
                retry_count += 1
        
        raise Exception("Tất cả API keys đều đã bị lỗi")
    
    def search_videos(
        self,
        query: str = "",
        max_results: int = 50,
        video_type: str = "any",
        page_token: Optional[str] = None,
        video_duration: Optional[str] = None,
        order: str = "viewCount",
    ) -> Dict:
        endpoint = f"{self.base_url}/search"
        params = {
            "part": "snippet",
            "q": query,
            "type": "video",
            "videoType": video_type,
            "maxResults": max_results,
        }
        if page_token:
            params["pageToken"] = page_token
        if video_duration:
            # 'short' | 'medium' | 'long' theo YouTube Data API
            params["videoDuration"] = video_duration
        if order:
            # 'date' | 'rating' | 'relevance' | 'title' | 'videoCount' | 'viewCount'
            params["order"] = order
        return self.make_api_request(endpoint, params)
    
    def get_video_details(self, video_ids: List[str]) -> Dict:
        if not video_ids:
            return {}
            
        endpoint = f"{self.base_url}/videos"
        
        params = {
            'part': 'snippet,statistics',
            'id': ','.join(video_ids)
        }
        
        return self.make_api_request(endpoint, params)
    
    def crawl_videos(self, query: str, max_results: int = 50) -> Dict:
        # Search for videos directly using YouTube API
        print(f"Searching for videos with query: '{query}'")
        search_results = self.search_videos(query=query, max_results=max_results, video_type="any")
        
        if not search_results or 'items' not in search_results:
            print("No search results found")
            return {}
        
        # Extract all video IDs from search results
        video_ids = []
        video_items = []
        for item in search_results.get('items', []):
            if item.get('id', {}).get('kind') == 'youtube#video':
                video_id = item.get('id', {}).get('videoId')
                if video_id:
                    video_ids.append(video_id)
                    video_items.append(item)
        
        if not video_ids:
            print("No videos found in search results")
            return {}
        
        print(f"Found {len(video_ids)} videos for query '{query}'")
        
        # Limit to max_results (50)
        if len(video_ids) > max_results:
            video_ids = video_ids[:max_results]
            video_items = video_items[:max_results]
            print(f"Limited to {max_results} videos as requested")
        
        # Get detailed information for all videos
        video_details = self.get_video_details(video_ids)
        
        # Save to CSV with keyword in filename
        self.save_to_csv(video_items, video_details, query)
        
        return {
            'search_results': video_items,
            'video_details': video_details,
            'total_videos': len(video_ids)
        }
    
    def save_to_csv(self, search_results: List[Dict], video_details: Dict, query: str) -> str:
        filename = str(_BASE_DIR / f"youtube_videos_{query}.csv")
        
        # Create a mapping of video_id to details for quick lookup
        details_map = {}
        if video_details.get('items'):
            for item in video_details['items']:
                video_id = item.get('id', '')
                details_map[video_id] = item
        
        # Prepare CSV data for all videos
        csv_rows = []
        for search_result in search_results:
            snippet = search_result.get('snippet', {})
            video_id = search_result.get('id', {}).get('videoId', '')
            
            # Get statistics from video details
            statistics = {}
            if video_id in details_map:
                statistics = details_map[video_id].get('statistics', {})
            
            # Select best available thumbnail url
            thumbs = snippet.get('thumbnails', {})
            thumb_url = (
                thumbs.get('maxres', {}).get('url') or
                thumbs.get('standard', {}).get('url') or
                thumbs.get('high', {}).get('url') or
                thumbs.get('medium', {}).get('url') or
                thumbs.get('default', {}).get('url') or
                ''
            )
            
            
            # Prepare row data
            row_data = {
                'video_id': video_id,
                'title': snippet.get('title', ''),
                'description': snippet.get('description', ''),
                'channel_title': snippet.get('channelTitle', ''),
                'published_at': snippet.get('publishedAt', ''),
                'thumbnail_url': thumb_url,
                'view_count': statistics.get('viewCount', '0'),
                'like_count': statistics.get('likeCount', '0'),
                'comment_count': statistics.get('commentCount', '0'),
                'url': f"https://www.youtube.com/watch?v={video_id}"
            }
            csv_rows.append(row_data)
        
        # Write to CSV
        if csv_rows:
            with open(filename, 'w', newline='', encoding='utf-8') as f:
                writer = csv.DictWriter(f, fieldnames=csv_rows[0].keys())
                writer.writeheader()
                writer.writerows(csv_rows)
        
        print(f"Data for {len(csv_rows)} videos saved to {filename}")
        return filename


def crawl_youtube_sync(keyword: str, max_items: int = 20) -> List[Dict]:
    """
    Crawl YouTube bằng API chính thức theo keyword.
    Trả về list video (tối đa 60). API 50/lần nên gọi 2 trang nếu cần 60.
    """
    crawler = YouTubeViewCrawler()
    want = min(max_items, 60)
    if want <= 0:
        return []

    # Chia đều: 1/2 video thường, 1/2 Shorts
    long_quota = want // 2
    short_quota = want - long_quota

    video_items: List[Dict] = []
    seen_ids: set[str] = set()

    # Gọi 1 lần cho video thường
    time.sleep(random.uniform(0.3, 1.0))
    long_results = crawler.search_videos(
        query=keyword,
        max_results=min(long_quota, 50),
        video_type="any",
        order="viewCount",
    ) if long_quota > 0 else {}

    if long_results and "items" in long_results:
        for item in long_results.get("items", []):
            if item.get("id", {}).get("kind") == "youtube#video":
                vid = item.get("id", {}).get("videoId")
                if vid and vid not in seen_ids and len(video_items) < long_quota:
                    video_items.append(item)
                    seen_ids.add(vid)

    # Gọi 1 lần cho Shorts (videoDuration=short)
    time.sleep(random.uniform(0.3, 1.0))
    short_results = crawler.search_videos(
        query=keyword,
        max_results=min(short_quota, 50),
        video_type="any",
        video_duration="short",
        order="viewCount",
    ) if short_quota > 0 else {}

    if short_results and "items" in short_results:
        for item in short_results.get("items", []):
            if item.get("id", {}).get("kind") == "youtube#video":
                vid = item.get("id", {}).get("videoId")
                if vid and vid not in seen_ids and len(video_items) < want:
                    item.setdefault("content_type", "short")
                    video_items.append(item)
                    seen_ids.add(vid)

    if not video_items:
        return []

    video_ids = [it.get("id", {}).get("videoId", "") for it in video_items]
    video_ids = [v for v in video_ids if v][:want]

    details_map: Dict[str, Dict] = {}
    for i in range(0, len(video_ids), 50):
        batch = video_ids[i : i + 50]
        time.sleep(random.uniform(0.3, 1.0))
        details = crawler.get_video_details(batch)
        if details.get("items"):
            for d in details["items"]:
                vid = d.get("id", "")
                if vid:
                    details_map[vid] = d

    rows: List[Dict] = []
    for search_result in video_items[:want]:
        snippet = search_result.get("snippet", {})
        video_id = search_result.get("id", {}).get("videoId", "")
        if not video_id:
            continue
        statistics: Dict = {}
        if video_id in details_map:
            statistics = details_map[video_id].get("statistics", {})
        thumbs = snippet.get("thumbnails", {})
        thumb_url = (
            thumbs.get("maxres", {}).get("url")
            or thumbs.get("standard", {}).get("url")
            or thumbs.get("high", {}).get("url")
            or thumbs.get("medium", {}).get("url")
            or thumbs.get("default", {}).get("url")
            or ""
        )
        rows.append({
            "video_id": video_id,
            "title": snippet.get("title", ""),
            "description": snippet.get("description", ""),
            "channel_title": snippet.get("channelTitle", ""),
            "published_at": snippet.get("publishedAt", ""),
            "thumbnail_url": thumb_url,
            "view_count": statistics.get("viewCount", "0"),
            "like_count": statistics.get("likeCount", "0"),
            "comment_count": statistics.get("commentCount", "0"),
            "url": f"https://www.youtube.com/watch?v={video_id}",
        })
    return rows


def main():
    """
    Script test (chạy tay): python crawlers/youtube_crawler.py "keyword"
    Không dùng trong flow backend chính.
    """
    import sys as _sys

    kw = " ".join(_sys.argv[1:]).strip() or "test"
    crawler = YouTubeViewCrawler()
    result = crawler.crawl_videos(query=kw, max_results=20)
    print(f"Crawled {result.get('total_videos', 0)} videos for '{kw}'")


if __name__ == "__main__":
    main()