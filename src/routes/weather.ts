import express, { Request, Response } from 'express';
import { z } from 'zod';
import axios from 'axios';

const weatherRouter = express.Router();

// Validation schemas
const weatherLocationSchema = z.object({
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  units: z.enum(['metric', 'imperial', 'standard']).optional().default('imperial'),
});

/**
 * GET /api/v1/weather/current
 * Get current weather conditions
 */
weatherRouter.get('/current', async (req: Request, res: Response) => {
  try {
    const lat = parseFloat(req.query.lat as string);
    const lon = parseFloat(req.query.lon as string);
    const units = (req.query.units as string) || 'imperial';

    const { lat: latitude, lon: longitude, units: unitType } = weatherLocationSchema.parse({
      lat,
      lon,
      units,
    });

    const apiKey = process.env.OPENWEATHERMAP_API_KEY;
    if (!apiKey || apiKey === 'PLACEHOLDER_GET_FROM_OPENWEATHERMAP_ORG') {
      return res.status(503).json({
        success: false,
        error: 'Weather service not configured. Please add OPENWEATHERMAP_API_KEY to environment.',
      });
    }

    const response = await axios.get('https://api.openweathermap.org/data/2.5/weather', {
      params: {
        lat: latitude,
        lon: longitude,
        units: unitType,
        appid: apiKey,
      },
    });

    const data = response.data;

    return res.json({
      success: true,
      location: {
        lat: latitude,
        lon: longitude,
        name: data.name,
        country: data.sys.country,
      },
      weather: {
        temp: data.main.temp,
        feelsLike: data.main.feels_like,
        tempMin: data.main.temp_min,
        tempMax: data.main.temp_max,
        pressure: data.main.pressure,
        humidity: data.main.humidity,
        condition: data.weather[0].main,
        description: data.weather[0].description,
        icon: data.weather[0].icon,
        wind: {
          speed: data.wind.speed,
          deg: data.wind.deg,
        },
        clouds: data.clouds.all,
        visibility: data.visibility,
        sunrise: data.sys.sunrise,
        sunset: data.sys.sunset,
      },
      units: unitType,
      timestamp: data.dt,
    });
  } catch (error: any) {
    console.error('[Weather] Error fetching current weather:', error);
    return res.status(500).json({
      success: false,
      error: error.response?.data?.message || error.message || 'Failed to fetch weather data',
    });
  }
});

/**
 * GET /api/v1/weather/forecast
 * Get 5-day weather forecast (3-hour intervals)
 */
weatherRouter.get('/forecast', async (req: Request, res: Response) => {
  try {
    const lat = parseFloat(req.query.lat as string);
    const lon = parseFloat(req.query.lon as string);
    const units = (req.query.units as string) || 'imperial';

    const { lat: latitude, lon: longitude, units: unitType } = weatherLocationSchema.parse({
      lat,
      lon,
      units,
    });

    const apiKey = process.env.OPENWEATHERMAP_API_KEY;
    if (!apiKey || apiKey === 'PLACEHOLDER_GET_FROM_OPENWEATHERMAP_ORG') {
      return res.status(503).json({
        success: false,
        error: 'Weather service not configured. Please add OPENWEATHERMAP_API_KEY to environment.',
      });
    }

    const response = await axios.get('https://api.openweathermap.org/data/2.5/forecast', {
      params: {
        lat: latitude,
        lon: longitude,
        units: unitType,
        appid: apiKey,
      },
    });

    const data = response.data;

    const forecast = data.list.map((item: any) => ({
      timestamp: item.dt,
      datetime: item.dt_txt,
      temp: item.main.temp,
      feelsLike: item.main.feels_like,
      tempMin: item.main.temp_min,
      tempMax: item.main.temp_max,
      pressure: item.main.pressure,
      humidity: item.main.humidity,
      condition: item.weather[0].main,
      description: item.weather[0].description,
      icon: item.weather[0].icon,
      clouds: item.clouds.all,
      wind: {
        speed: item.wind.speed,
        deg: item.wind.deg,
      },
      pop: item.pop, // Probability of precipitation
    }));

    return res.json({
      success: true,
      location: {
        lat: latitude,
        lon: longitude,
        name: data.city.name,
        country: data.city.country,
      },
      forecast,
      units: unitType,
      count: forecast.length,
    });
  } catch (error: any) {
    console.error('[Weather] Error fetching forecast:', error);
    return res.status(500).json({
      success: false,
      error: error.response?.data?.message || error.message || 'Failed to fetch forecast data',
    });
  }
});

/**
 * GET /api/v1/weather/air-quality
 * Get air quality index and pollutants
 */
weatherRouter.get('/air-quality', async (req: Request, res: Response) => {
  try {
    const lat = parseFloat(req.query.lat as string);
    const lon = parseFloat(req.query.lon as string);

    const { lat: latitude, lon: longitude } = weatherLocationSchema.parse({
      lat,
      lon,
      units: 'metric', // not used for air quality
    });

    const apiKey = process.env.OPENWEATHERMAP_API_KEY;
    if (!apiKey || apiKey === 'PLACEHOLDER_GET_FROM_OPENWEATHERMAP_ORG') {
      return res.status(503).json({
        success: false,
        error: 'Weather service not configured. Please add OPENWEATHERMAP_API_KEY to environment.',
      });
    }

    const response = await axios.get('https://api.openweathermap.org/data/2.5/air_pollution', {
      params: {
        lat: latitude,
        lon: longitude,
        appid: apiKey,
      },
    });

    const data = response.data.list[0];

    return res.json({
      success: true,
      location: {
        lat: latitude,
        lon: longitude,
      },
      airQuality: {
        aqi: data.main.aqi, // 1=Good, 2=Fair, 3=Moderate, 4=Poor, 5=Very Poor
        co: data.components.co,
        no: data.components.no,
        no2: data.components.no2,
        o3: data.components.o3,
        so2: data.components.so2,
        pm2_5: data.components.pm2_5,
        pm10: data.components.pm10,
        nh3: data.components.nh3,
      },
      timestamp: data.dt,
    });
  } catch (error: any) {
    console.error('[Weather] Error fetching air quality:', error);
    return res.status(500).json({
      success: false,
      error: error.response?.data?.message || error.message || 'Failed to fetch air quality data',
    });
  }
});

export default weatherRouter;
