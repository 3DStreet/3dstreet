import os
import json
import base64
import requests
from flask import Request, jsonify
import functions_framework

@functions_framework.http
def enhanceImagePython(request: Request):
    """
    HTTP Cloud Function to enhance 3D scene images using OpenAI's image editing API.
    
    Expected JSON payload:
    {
        "imageBase64": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA...",
        "prompt": "Convert this low-poly 3D street scene into photorealistic...",
        "sceneData": {...} // optional scene metadata
    }
    """
    
    # Set CORS headers for web requests
    if request.method == 'OPTIONS':
        headers = {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'POST',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
            'Access-Control-Max-Age': '3600'
        }
        return ('', 204, headers)
    
    headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Content-Type': 'application/json'
    }
    
    try:
        # Get OpenAI API key from environment
        api_key = os.getenv("OPENAI_API_KEY") or os.getenv("OPEN_AI_API_KEY")
        if not api_key:
            return jsonify({
                'success': False,
                'error': 'OpenAI API key not configured'
            }), 500, headers
        
        # Parse request data
        if request.content_type and 'application/json' in request.content_type:
            request_json = request.get_json(silent=True)
        else:
            request_json = None
            
        if not request_json:
            return jsonify({
                'success': False,
                'error': 'Invalid JSON payload'
            }), 400, headers
        
        # Extract required fields
        image_base64 = request_json.get('imageBase64')
        prompt = request_json.get('prompt', 
            "Convert this low-poly 3D street scene into a photorealistic urban environment with realistic lighting, textures, and details")
        scene_data = request_json.get('sceneData')  # Optional metadata
        
        # Validate required data
        if not image_base64:
            return jsonify({
                'success': False,
                'error': 'Image data is required. Please provide imageBase64 field.'
            }), 400, headers
        
        print(f'Processing image enhancement request...')
        print(f'Image size: {len(image_base64) // 1024} KB')
        print(f'Prompt: {prompt[:100]}...')
        
        # Clean base64 data (remove data URL prefix if present)
        if image_base64.startswith('data:image/'):
            image_base64 = image_base64.split(',', 1)[1]
        
        # Decode base64 to bytes
        try:
            image_bytes = base64.b64decode(image_base64)
        except Exception as e:
            return jsonify({
                'success': False,
                'error': f'Invalid base64 image data: {str(e)}'
            }), 400, headers
        
        print(f'Decoded image size: {len(image_bytes) // 1024} KB')
        
        # Prepare request to OpenAI API
        openai_headers = {
            "Authorization": f"Bearer {api_key}"
        }
        
        # Create multipart form data
        files = {
            "image": ("image.png", image_bytes, "image/png")
        }
        
        data = {
            "prompt": prompt,
            "model": "gpt-image-1",
            "size": "1024x1024",
            "quality": "low"
        }
        
        print('Sending request to OpenAI API...')
        
        # Make request to OpenAI
        response = requests.post(
            "https://api.openai.com/v1/images/edits",
            headers=openai_headers,
            files=files,
            data=data,
            timeout=300  # 5 minute timeout
        )
        
        print(f'OpenAI API response status: {response.status_code}')
        
        # Handle OpenAI API response
        if response.status_code == 200:
            result = response.json()
            
            if 'data' in result and len(result['data']) > 0:
                enhanced_image_b64 = result['data'][0]['b64_json']
                revised_prompt = result['data'][0].get('revised_prompt', prompt)
                
                print('✅ Image enhancement successful')
                
                return jsonify({
                    'success': True,
                    'imageData': enhanced_image_b64,
                    'revised_prompt': revised_prompt,
                    'original_prompt': prompt
                }), 200, headers
            else:
                print('❌ No image data in OpenAI response')
                return jsonify({
                    'success': False,
                    'error': 'No image data received from OpenAI'
                }), 500, headers
                
        else:
            # Handle OpenAI API errors
            error_text = response.text
            print(f'❌ OpenAI API error: {error_text}')
            
            error_message = 'Unknown OpenAI API error'
            status_code = 500
            
            try:
                error_json = response.json()
                if 'error' in error_json:
                    error_message = error_json['error'].get('message', error_message)
            except:
                error_message = error_text
            
            # Map OpenAI status codes to appropriate HTTP responses
            if response.status_code == 400:
                status_code = 400
                error_message = f'Invalid request to OpenAI: {error_message}'
            elif response.status_code == 401:
                status_code = 500  # Don't expose auth issues to client
                error_message = 'OpenAI API authentication failed'
            elif response.status_code == 429:
                status_code = 429
                error_message = 'OpenAI API rate limit exceeded. Please try again later.'
            
            return jsonify({
                'success': False,
                'error': error_message
            }), status_code, headers
    
    except requests.exceptions.Timeout:
        print('❌ Request to OpenAI API timed out')
        return jsonify({
            'success': False,
            'error': 'Request timed out. Please try again.'
        }), 504, headers
        
    except requests.exceptions.RequestException as e:
        print(f'❌ Network error: {str(e)}')
        return jsonify({
            'success': False,
            'error': 'Network error occurred. Please try again.'
        }), 503, headers
        
    except Exception as e:
        print(f'❌ Unexpected error: {str(e)}')
        return jsonify({
            'success': False,
            'error': f'Internal server error: {str(e)}'
        }), 500, headers