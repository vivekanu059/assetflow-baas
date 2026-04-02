import axios from 'axios';

// 1. Point to the cloud URL if it exists, otherwise fall back to localhost
const BACKEND_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api';

// 2. Create a central Axios instance pointing to your API Gateway
const api = axios.create({
  baseURL: `${BACKEND_URL}/api`,
});

// Add a request interceptor
api.interceptors.request.use(
  (config) => {
    // Before any request is sent, grab the token from local storage
    const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
    
    // If we have a token, attach it to the Authorization header automatically
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Add a response interceptor to handle expired tokens gracefully
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response && error.response.status === 401) {
      // If the API says our token is invalid/expired, log the user out
      if (typeof window !== 'undefined') {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  }
);

export default api;
