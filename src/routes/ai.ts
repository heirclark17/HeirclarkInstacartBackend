import { Router, Request, Response } from 'express';
import multer from 'multer';
import OpenAI from 'openai';

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

router.post(
  '/guess-nutrition-from-photo',
  upload.single('image'),
  async (req: Request, res: Response) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'Image file is required' });
      }

      // Convert image buffer to base64 for Vision-like call
      const base64 = req.file.buffer.toString('base64');

      const prompt = `
You are a nutrition assistant. The user has uploaded a photo of a meal.
1) Describe the meal briefly.
2) Estimate:
   - Total calories (kcal)
   - Protein (g)
   - Carbohydrates (g)
   - Fat (g)

Return a STRICT JSON object with keys:
{
  "mealName": string,
  "calories": number,
  "protein": number,
  "carbs": number,
  "fats": number,
  "explanation": string
}
      `.trim();

      const completion = await openai.chat.completions.create({
        model: 'gpt-4.1-mini', // or current vision-capable model
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              {
                type: 'input_image',
                image_url: { url: `data:${req.file.mimetype};base64,${base64}` },
              },
            ],
          },
        ],
        response_format: { type: 'json_object' },
      });

      const raw = completion.choices[0].message.content;
      let parsed;
      try {
        parsed = raw ? JSON.parse(raw) : null;
      } catch (e) {
        return res.status(500).json({
          error: 'Failed to parse AI response',
          raw,
        });
      }

      const result = {
        mealName: parsed.mealName || 'Meal',
        calories: Number(parsed.calories) || 0,
        protein: Number(parsed.protein) || 0,
        carbs: Number(parsed.carbs) || 0,
        fats: Number(parsed.fats) || 0,
        explanation: parsed.explanation || '',
      };

      res.json(result);
    } catch (err) {
      console.error('AI nutrition error:', err);
      res.status(500).json({ error: 'AI nutrition estimation failed' });
    }
  }
);

export default router;

