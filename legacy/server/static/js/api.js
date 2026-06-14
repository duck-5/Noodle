const API_BASE = '/api';

class ApiClient {
  async request(path, options = {}) {
    const url = `${API_BASE}${path}`;
    
    // Inject headers
    options.headers = options.headers || {};
    const token = localStorage.getItem('jwt_token');
    if (token) {
      options.headers['Authorization'] = `Bearer ${token}`;
    }

    // JSON handling for bodies that are not FormData
    if (options.body && !(options.body instanceof FormData) && typeof options.body === 'object') {
      options.headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(options.body);
    }

    try {
      const response = await fetch(url, options);
      
      if (response.status === 401) {
        // Auth failure - clear session and redirect to login
        localStorage.removeItem('jwt_token');
        localStorage.removeItem('user_info');
        window.location.hash = '#/login';
        throw new Error('Unauthorized');
      }

      // Check if file download proxying (streaming response)
      if (path.startsWith('/files/download')) {
        return response; // Return raw response for streaming/downloading
      }

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.detail || data.error || 'Request failed');
      }
      return data;
    } catch (error) {
      console.error(`API Error [${options.method || 'GET'} ${path}]:`, error);
      throw error;
    }
  }

  get(path) {
    return this.request(path, { method: 'GET' });
  }

  post(path, body) {
    return this.request(path, { method: 'POST', body });
  }

  put(path, body) {
    return this.request(path, { method: 'PUT', body });
  }

  delete(path) {
    return this.request(path, { method: 'DELETE' });
  }
}

export const api = new ApiClient();
