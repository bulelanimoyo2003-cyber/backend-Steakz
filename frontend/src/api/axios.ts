import axios from 'axios';

function normalizeUrl(value: string | undefined) {
  return value ? value.replace(/\/+$/g, '').trim() : undefined;
}

// In dev mode, use relative URL (vite proxy handles routing to localhost:3001)
// In production, use env variable or fallback
const isDev = import.meta.env.DEV;
let baseURL: string;

if (isDev) {
  // Dev mode: use relative path, vite proxy will route to http://localhost:3001
  baseURL = '/api';
  console.log('[Axios] Dev mode: using relative API path', baseURL);
} else {
  // Production mode: use env variable or fallback
  const envUrl = normalizeUrl(import.meta.env.VITE_API_URL);
  const fallbackProdUrl = 'https://steakz-backend-i5qe.onrender.com';
  const apiBaseUrl = envUrl || fallbackProdUrl;
  baseURL = apiBaseUrl.endsWith('/api') ? apiBaseUrl : `${apiBaseUrl.replace(/\/+$/, '')}/api`;
  
  if (!envUrl) {
    console.warn('[Axios] Production mode: VITE_API_URL is not set; using fallback:', fallbackProdUrl);
  }
  console.log('[Axios] Production mode: using absolute URL', baseURL);
}

const api = axios.create({
  baseURL,
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('steakz_token');
  if (!token || token === 'undefined') return config;

  if (!config.headers) {
    config.headers = {} as typeof config.headers;
  }

  config.headers.Authorization = `Bearer ${token}`;
  return config;
});

export default api;
