import axios from 'axios';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL + '/api',
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
