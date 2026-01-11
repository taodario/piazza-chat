import json
import os
import time
import random
from piazza_api import Piazza
from piazza_api.exceptions import RequestError

COURSE_ID = "meu2e1usaod412"

def save_partial(posts):
    with open("piazza_data_partial.json", "w") as f:
        json.dump(posts, f, indent=2)

def fetch_with_retry(course, post_id, max_retries=6):
    """Fetch a post with exponential backoff on rate limits."""
    backoff = 3
    for attempt in range(max_retries):
        try:
            return course.get_post(post_id)
        except RequestError as e:
            if "too fast" in str(e):
                print(f"Rate limit hit on {post_id}. Backing off {backoff}s...")
                time.sleep(backoff + random.uniform(0, 1.5))
                backoff *= 2
            else:
                raise
    print(f"Skipping {post_id} after {max_retries} failed attempts.")
    return None

def main():
    p = Piazza()
    p.user_login()
    course = p.network(COURSE_ID)
    all_posts = course.get_feed(limit=5000)["feed"]

    posts = []
    fetched_ids = set()
    if os.path.exists("piazza_data_partial.json"):
        with open("piazza_data_partial.json", "r") as f:
            posts = json.load(f)
            fetched_ids = {p["id"] for p in posts}

    for i, summary in enumerate(all_posts):
        post_id = summary["id"]
        if post_id in fetched_ids:
            continue

        full_post = fetch_with_retry(course, post_id)
        if not full_post:
            continue

        simplified = {
            "id": post_id,
            "subject": full_post["history"][0]["subject"],
            "content": full_post["history"][0]["content"],
            "created": full_post["created"],
            "tags": full_post.get("tags", []),
            "type": full_post.get("type"),
            "answers": {
                "instructor": [
                    a.get("content", "") for a in full_post.get("children", [])
                    if a.get("type") == "i_answer"
                ],
                "student": [
                    a.get("content", "") for a in full_post.get("children", [])
                    if a.get("type") == "s_answer"
                ],
                "followups": [
                    {
                        "content": f.get("subject", "") or f.get("content", ""),
                        "comments": [
                            c.get("subject", "") or c.get("content", "")
                            for c in f.get("children", [])
                        ],
                    }
                    for f in full_post.get("children", [])
                    if f.get("type") == "followup"
                ],
            },
        }

        posts.append(simplified)
        fetched_ids.add(post_id)

    with open("piazza_data.json", "w") as f:
        json.dump(posts, f, indent=2)

if __name__ == "__main__":
    main()
