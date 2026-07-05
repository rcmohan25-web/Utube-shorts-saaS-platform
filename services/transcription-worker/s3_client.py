"""S3/R2 helper. R2 is S3-compatible, so boto3 works unchanged — just point
S3_ENDPOINT at the R2 endpoint (see ADR-003 in the platform README)."""
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


def upload_file(local_path: str, key: str) -> str:
    bucket = os.environ["S3_BUCKET"]
    get_client().upload_file(local_path, bucket, key)
    return key


def download_file(key: str, local_path: str) -> str:
    bucket = os.environ["S3_BUCKET"]
    get_client().download_file(bucket, key, local_path)
    return local_path
