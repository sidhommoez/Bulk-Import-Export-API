#!/bin/bash

# Wait for LocalStack to be ready
echo "Waiting for LocalStack to be ready..."
sleep 5

# Create S3 bucket
echo "Creating S3 bucket 'bulk-import-export'..."
awslocal s3 mb s3://bulk-import-export

# Set bucket policy for public read (for development/testing only)
echo "Setting bucket policy..."
awslocal s3api put-bucket-policy --bucket bulk-import-export --policy '{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "PublicReadGetObject",
      "Effect": "Allow",
      "Principal": "*",
      "Action": [
        "s3:GetObject",
        "s3:PutObject",
        "s3:DeleteObject"
      ],
      "Resource": "arn:aws:s3:::bulk-import-export/*"
    }
  ]
}'

# Enable CORS for the bucket
echo "Enabling CORS..."
awslocal s3api put-bucket-cors --bucket bulk-import-export --cors-configuration '{
  "CORSRules": [
    {
      "AllowedOrigins": ["*"],
      "AllowedMethods": ["GET", "PUT", "POST", "DELETE", "HEAD"],
      "AllowedHeaders": ["*"],
      "ExposeHeaders": ["ETag"],
      "MaxAgeSeconds": 3600
    }
  ]
}'

# Verify bucket creation
echo "Verifying bucket creation..."
awslocal s3 ls

echo "LocalStack initialization complete!"
