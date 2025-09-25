#!/usr/bin/env python3
"""
Test the Cloud Function with your uploaded image
This handles large images properly without command line length limits
"""

import requests
import base64
import json
import subprocess
import os

def get_auth_token():
    """Get GCP auth token"""
    try:
        result = subprocess.run(['gcloud', 'auth', 'print-identity-token'], 
                              capture_output=True, text=True, check=True)
        return result.stdout.strip()
    except subprocess.CalledProcessError as e:
        print(f"❌ Failed to get auth token: {e}")
        return None

def test_cloud_function():
    """Test the cloud function with test-image.png"""
    
    # Check if image file exists
    if not os.path.exists('test-image.png'):
        print("❌ Error: test-image.png not found!")
        print("Please make sure test-image.png is in the current directory")
        return
    
    # Get file size
    file_size = os.path.getsize('test-image.png')
    print(f"📏 Image file size: {file_size:,} bytes ({file_size/1024/1024:.1f} MB)")
    
    # Check if image is too large (OpenAI has limits)
    if file_size > 4 * 1024 * 1024:  # 4MB limit
        print("⚠️  Warning: Image is quite large. OpenAI may reject it.")
        print("   Consider resizing to under 4MB for better results.")
    
    print("🔄 Converting image to base64...")
    
    # Read and encode image
    try:
        with open('test-image.png', 'rb') as f:
            image_data = f.read()
        
        image_b64 = base64.b64encode(image_data).decode('utf-8')
        print(f"📏 Base64 size: {len(image_b64):,} characters")
        
    except Exception as e:
        print(f"❌ Failed to read image: {e}")
        return
    
    # Get auth token
    print("🔑 Getting authentication token...")
    token = get_auth_token()
    if not token:
        return
    
    # Prepare request
    url = "https://us-central1-dev-3dstreet.cloudfunctions.net/enhanceImagePython"
    headers = {
        "Authorization": f"bearer {token}",
        "Content-Type": "application/json"
    }
    
    payload = {
        "imageBase64": f"data:image/png;base64,{image_b64}",
        "prompt": "Convert this into a photorealistic scene with realistic lighting, textures, and details"
    }
    
    print("🚀 Sending request to Cloud Function...")
    print(f"   URL: {url}")
    print(f"   Payload size: {len(json.dumps(payload)):,} characters")
    
    try:
        # Make the request with a longer timeout
        response = requests.post(url, headers=headers, json=payload, timeout=300)
        
        print(f"📡 Response status: {response.status_code}")
        
        # Save response
        with open('response.json', 'w') as f:
            if response.headers.get('content-type', '').startswith('application/json'):
                json.dump(response.json(), f, indent=2)
            else:
                f.write(response.text)
        
        print("📄 Response saved to response.json")
        
        # Check if successful
        if response.status_code == 200:
            try:
                result = response.json()
                if result.get('success'):
                    print("✅ Success! Extracting enhanced image...")
                    
                    # Extract and save enhanced image
                    enhanced_b64 = result.get('imageData', '')
                    if enhanced_b64:
                        enhanced_data = base64.b64decode(enhanced_b64)
                        with open('enhanced-image.png', 'wb') as f:
                            f.write(enhanced_data)
                        
                        enhanced_size = len(enhanced_data)
                        print(f"🎨 Enhanced image saved as enhanced-image.png ({enhanced_size:,} bytes)")
                        print("")
                        print("📂 Files created:")
                        print("   - response.json (full API response)")
                        print("   - enhanced-image.png (OpenAI enhanced version)")
                        print("")
                        print("💡 You can download enhanced-image.png to see the result!")
                        
                        # Show prompts if available
                        if result.get('revised_prompt'):
                            print(f"📝 Revised prompt: {result['revised_prompt']}")
                    else:
                        print("❌ No image data in successful response")
                        print(f"Response: {result}")
                else:
                    print("❌ Function returned error:")
                    print(f"   {result.get('error', 'Unknown error')}")
            except json.JSONDecodeError:
                print("❌ Invalid JSON response:")
                print(response.text[:500])
        else:
            print(f"❌ HTTP Error {response.status_code}:")
            try:
                error_data = response.json()
                print(f"   {error_data.get('error', response.text)}")
            except:
                print(f"   {response.text[:500]}")
                
    except requests.exceptions.Timeout:
        print("❌ Request timed out (5 minutes)")
        print("   The image might be too large or OpenAI is taking too long")
        
    except requests.exceptions.RequestException as e:
        print(f"❌ Network error: {e}")
        
    except Exception as e:
        print(f"❌ Unexpected error: {e}")
    
    print("")
    print("🏁 Test completed!")

if __name__ == "__main__":
    test_cloud_function()
