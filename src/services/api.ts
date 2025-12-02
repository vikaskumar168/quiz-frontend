import type { AxiosError, AxiosInstance, AxiosRequestConfig, InternalAxiosRequestConfig } from "axios";
import axios from "axios";

declare module "axios" {
    interface AxiosRequestConfig {
        _retry?: boolean;
    }
}


let getAccessToken: () => string | null = () => null;
let onLogout: () => void = () => {};

export function setAuthHelpers(opts:{
    getToken: () => string | null;
    logout: () => void;
}) {
    getAccessToken = opts.getToken;
    onLogout = opts.logout;
}

const api: AxiosInstance = axios.create({
    baseURL: import.meta.env.VITE_API_BASE || "http://localhost:8000/api",
    withCredentials: true,
    headers: {
        "Content-Type": "application/json",
    },
});

api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
    const token = getAccessToken();
    if (token) {
        config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
});

// Handle 401 Unauthorized responses
let isRefreshing = false;
let failedQueue: Array<{
    resolve: (value?:unknown) => void;
    reject: (err?: any) => void;
}> = [];

const processQueue = (error: any, token: string | null = null) => {
    failedQueue.forEach((p) => {
        if(error) p.reject(error);
        else p.resolve(token);
    });
    failedQueue = [];
};

api.interceptors.response.use(
    (res) => res,
    async (err: AxiosError & { config: AxiosRequestConfig }) => {
        const originalConfig = err.config!;
        if(err.response?.status === 401 && !originalConfig._retry && !originalConfig.url?.includes("/auth/refresh")){
            if(isRefreshing){
                return new Promise(function(resolve,reject){
                    failedQueue.push({resolve,reject});
                })
                .then(() => api(originalConfig))
                .catch((err) => Promise.reject(err));
            }

            originalConfig._retry = true;
            isRefreshing = true;

            try{
                const refreshResp =  await axios.post(`${api.defaults.baseURL}/auth/refresh`, {}, {
                    withCredentials: true,
                });
                const newAccessToken = (refreshResp.data as any)?.accessToken;
                processQueue(null, newAccessToken);
                return api(originalConfig);
            } catch (refreshError) {
                processQueue(refreshError, null);
                onLogout();
                return Promise.reject(refreshError);
            } finally {
                isRefreshing = false;
            }
        }
        return Promise.reject(err);
    }
);

export default api;