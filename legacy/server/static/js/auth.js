export const auth = {
  isAuthenticated() {
    return !!localStorage.getItem('jwt_token');
  },

  getToken() {
    return localStorage.getItem('jwt_token');
  },

  setSession(token, userInfo) {
    localStorage.setItem('jwt_token', token);
    if (userInfo) {
      localStorage.setItem('user_info', JSON.stringify(userInfo));
    }
  },

  getUserInfo() {
    const info = localStorage.getItem('user_info');
    if (info) {
      try {
        return JSON.parse(info);
      } catch (e) {
        return null;
      }
    }
    return null;
  },

  logout() {
    localStorage.removeItem('jwt_token');
    localStorage.removeItem('user_info');
    window.location.hash = '#/login';
  }
};
