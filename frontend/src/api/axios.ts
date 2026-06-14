import axios from 'axios';

function normalizeUrl(value: string | undefined) {
  return value ? value.replace(/\/+$/g, '').trim() : undefined;
}

const envUrl = normalizeUrl(import.meta.env.VITE_API_URL);
const fallbackProdUrl = 'https://steakz-backend-i5qe.onrender.com';
const apiBaseUrl = envUrl || (import.meta.env.DEV ? 'http://localhost:3001' : fallbackProdUrl);
const baseURL = apiBaseUrl.endsWith('/api') ? apiBaseUrl : `${apiBaseUrl.replace(/\/+$/, '')}/api`;

if (!envUrl && !import.meta.env.DEV) {
  console.warn('[Axios] VITE_API_URL is not set in production; using fallback backend URL:', fallbackProdUrl);
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
