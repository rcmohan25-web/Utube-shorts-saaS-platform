"""S3/R2 download helper for publish-worker.
R2 is S3-compatible — set S3_ENDPOINT to the R2 endpoint (ADR-003)."""
import os
import boto3

_client = None


def get_client():
    global _client
    if _client is None:
        _client = boto3.client(
            "s3",
            endpoint_url=os.environ.get("S3_ENDPOINT") or None,
            aws_access_key_id=os.environ.get("AWS_ACCESS_KEY_ID"),
            aws_secret_access_key=os.environ.get("AWS_SECRET_ACCESS_KEY"),
        )
    return _client


def download_file(key: str, local_path: str) -> str:
    bucket = os.environ["S3_BUCKET"]
    get_client().download_file(bucket, key, local_path)
    return local_path
