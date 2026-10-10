/**
 * Единственное место, где строятся адреса сервиса. Всё остальное берёт их отсюда: страница
 * может жить без косой черты на конце, и относительный путь в fetch уходит не туда
 * (на это уже наступали в старом дашборде).
 */
const base = import.meta.env.BASE_URL.endsWith('/') ? import.meta.env.BASE_URL : `${import.meta.env.BASE_URL}/`;

export const BASE_URL = base;
export const API_BASE = `${base}api/v1/`;
export const LOGIN_URL = `${base}login`;
export const LOGOUT_URL = `${base}logout`;

/** Режим фикстур: данные берутся из src/fixtures, сеть не нужна. Включается VITE_FIXTURES=1. */
export const FIXTURES_MODE = import.meta.env.VITE_FIXTURES === '1';
