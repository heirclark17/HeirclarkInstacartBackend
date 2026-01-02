import axios from 'axios';

const HEYGEN_API_BASE = 'https://api.heygen.com';

/**
 * HeyGen API Service
 * Handles avatar video generation via HeyGen's V2 API
 */

interface VideoGenerateResponse {
  error: {
    code: string;
    message: string;
  } | null;
  data: {
    video_id: string;
  } | null;
  code?: number; // Legacy field, may not be present
  message?: string | null;
}

interface VideoStatusResponse {
  code: number;
  data: {
    video_id: string;
    status: 'pending' | 'processing' | 'completed' | 'failed';
    video_url?: string;
    video_url_caption?: string;
    thumbnail_url?: string;
    duration?: number;
    error?: {
      code: string;
      message: string;
    };
  };
  message: string | null;
}

interface AvatarListResponse {
  code: number;
  data: {
    avatars: Array<{
      avatar_id: string;
      avatar_name: string;
      gender: string;
      preview_image_url: string;
      preview_video_url: string;
    }>;
  };
}

interface VoiceListResponse {
  code: number;
  data: {
    voices: Array<{
      voice_id: string;
      language: string;
      gender: string;
      name: string;
      preview_audio: string;
      support_pause: boolean;
      emotion_support: boolean;
    }>;
  };
}

/**
 * Validate and return the HeyGen API key
 * Checks format and prevents accidental exposure
 */
function getApiKey(): string {
  const apiKey = process.env.HEYGEN_API_KEY;

  if (!apiKey) {
    throw new Error('HEYGEN_API_KEY environment variable is not set');
  }

  // Validate key format (HeyGen keys are typically 32+ chars)
  if (apiKey.length < 20) {
    throw new Error('HEYGEN_API_KEY appears invalid (too short)');
  }

  // Prevent hardcoded test/placeholder keys
  const invalidPatterns = ['test', 'demo', 'placeholder', 'your_api_key', 'xxx'];
  if (invalidPatterns.some(p => apiKey.toLowerCase().includes(p))) {
    throw new Error('HEYGEN_API_KEY appears to be a placeholder value');
  }

  return apiKey;
}

/**
 * Sanitize script input to prevent injection
 */
function sanitizeScript(script: string): string {
  // Remove potential script tags and dangerous characters
  return script
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, '') // Strip HTML tags
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '') // Remove control chars
    .trim();
}

/**
 * Create an avatar video with the given script
 * @param script The text for the avatar to speak
 * @returns The video_id for status polling
 */
export async function createAvatarVideo(script: string): Promise<string> {
  const avatarId = process.env.HEYGEN_AVATAR_ID;
  const voiceId = process.env.HEYGEN_VOICE_ID;

  if (!avatarId || !voiceId) {
    throw new Error('HEYGEN_AVATAR_ID and HEYGEN_VOICE_ID must be set');
  }

  // Sanitize and validate script
  script = sanitizeScript(script);

  if (!script || script.length < 10) {
    throw new Error('Script is too short or empty after sanitization');
  }

  // Script must be under 5000 characters
  if (script.length > 5000) {
    script = script.substring(0, 4900) + '...';
    console.warn('[heygen] Script truncated to 5000 character limit');
  }

  try {
    console.log(`[heygen] Generating video with avatar=${avatarId}, voice=${voiceId}`);

    const response = await axios.post<VideoGenerateResponse>(
      `${HEYGEN_API_BASE}/v2/video/generate`,
      {
        video_inputs: [
          {
            character: {
              type: 'avatar',
              avatar_id: avatarId,
              avatar_style: 'normal',
            },
            voice: {
              type: 'text',
              input_text: script,
              voice_id: voiceId,
              speed: 1.0,
            },
            background: {
              type: 'color',
              value: '#000000', // Black background for B&W theme
            },
          },
        ],
        dimension: {
          width: 1280,
          height: 720,
        },
        aspect_ratio: '16:9',
      },
      {
        headers: {
          'X-Api-Key': getApiKey(),
          'Content-Type': 'application/json',
        },
        timeout: 30000,
      }
    );

    console.log(`[heygen] API response:`, JSON.stringify(response.data));

    // Check for error in response
    if (response.data.error) {
      console.error('[heygen] API returned error:', response.data.error);
      throw new Error(response.data.error.message || 'HeyGen API error');
    }

    // Check if we got a video_id
    if (!response.data.data?.video_id) {
      console.error('[heygen] No video_id in response:', response.data);
      throw new Error('HeyGen API did not return a video_id');
    }

    console.log(`[heygen] Video generation started: ${response.data.data.video_id}`);
    return response.data.data.video_id;
  } catch (error: any) {
    const errorData = error.response?.data;
    console.error('[heygen] createAvatarVideo failed:', JSON.stringify(errorData, null, 2) || error.message);
    throw new Error(`HeyGen video creation failed: ${errorData?.error?.message || errorData?.message || error.message}`);
  }
}

/**
 * Get the status and URL of a video
 * @param videoId The video ID from createAvatarVideo
 * @returns Status and video URL if completed
 */
export async function getVideoStatus(videoId: string): Promise<{
  status: 'pending' | 'processing' | 'completed' | 'failed';
  videoUrl: string | null;
  thumbnailUrl: string | null;
  duration: number | null;
  error: string | null;
}> {
  try {
    const response = await axios.get<VideoStatusResponse>(
      `${HEYGEN_API_BASE}/v1/video_status.get`,
      {
        params: { video_id: videoId },
        headers: {
          'X-Api-Key': getApiKey(),
        },
        timeout: 10000,
      }
    );

    const data = response.data.data;

    return {
      status: data.status,
      videoUrl: data.video_url || null,
      thumbnailUrl: data.thumbnail_url || null,
      duration: data.duration || null,
      error: data.error?.message || null,
    };
  } catch (error: any) {
    console.error('[heygen] getVideoStatus failed:', error.response?.data || error.message);
    throw new Error(`HeyGen status check failed: ${error.message}`);
  }
}

/**
 * List available avatars (useful for setup)
 */
export async function listAvatars(): Promise<AvatarListResponse['data']['avatars']> {
  try {
    const response = await axios.get<AvatarListResponse>(
      `${HEYGEN_API_BASE}/v2/avatars`,
      {
        headers: {
          'X-Api-Key': getApiKey(),
        },
        timeout: 10000,
      }
    );

    return response.data.data.avatars;
  } catch (error: any) {
    console.error('[heygen] listAvatars failed:', error.response?.data || error.message);
    throw new Error(`HeyGen avatar list failed: ${error.message}`);
  }
}

/**
 * List available voices (useful for setup)
 */
export async function listVoices(): Promise<VoiceListResponse['data']['voices']> {
  try {
    const response = await axios.get<VoiceListResponse>(
      `${HEYGEN_API_BASE}/v2/voices`,
      {
        headers: {
          'X-Api-Key': getApiKey(),
        },
        timeout: 10000,
      }
    );

    return response.data.data.voices;
  } catch (error: any) {
    console.error('[heygen] listVoices failed:', error.response?.data || error.message);
    throw new Error(`HeyGen voice list failed: ${error.message}`);
  }
}
