import axios from 'axios';

const HEYGEN_API_BASE = 'https://api.heygen.com';

/**
 * HeyGen API Service
 * Handles avatar video generation via HeyGen's V2 API
 */

interface VideoGenerateResponse {
  code: number;
  data: {
    video_id: string;
  };
  message: string | null;
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

function getApiKey(): string {
  const apiKey = process.env.HEYGEN_API_KEY;
  if (!apiKey) {
    throw new Error('HEYGEN_API_KEY environment variable is not set');
  }
  return apiKey;
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

  // Script must be under 5000 characters
  if (script.length > 5000) {
    script = script.substring(0, 4900) + '...';
    console.warn('[heygen] Script truncated to 5000 character limit');
  }

  try {
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

    if (response.data.code !== 100) {
      throw new Error(response.data.message || 'HeyGen API error');
    }

    console.log(`[heygen] Video generation started: ${response.data.data.video_id}`);
    return response.data.data.video_id;
  } catch (error: any) {
    console.error('[heygen] createAvatarVideo failed:', error.response?.data || error.message);
    throw new Error(`HeyGen video creation failed: ${error.message}`);
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
