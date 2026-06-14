import axios from 'axios';

function normalizeUrl(value: string | undefined) {
  return value ? value.replace(/\/+$|^\s+|\s+$/g, '') : undefined;
}

const envUrl = normalizeUrl(import.meta.env.VITE_API_URL);
const defaultBase = import.meta.env.DEV ? 'http://localhost:3001' : '/api';
const apiBaseUrl = envUrl || defaultBase;
const baseURL = apiBaseUrl.endsWith('/api') ? apiBaseUrl : `${apiBaseUrl.replace(/\/+$/, '')}/api`;

const api = axios.create({
  baseURL,
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('steakz_token');
  if (!token) return config;

  if (!config.headers) {
    config.headers = {} as typeof config.headers;
  }

  config.headers.Authorization = `Bearer ${token}`;
  return config;
});

export default api;
