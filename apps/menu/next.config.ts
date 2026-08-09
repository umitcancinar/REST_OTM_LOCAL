import type { NextConfig } from 'next';
import path from 'node:path';

const menuBasePath = process.env.MENU_BASE_PATH || '';
if (menuBasePath !== '' && menuBasePath !== '/menu') {
  throw new Error('MENU_BASE_PATH yalniz bos veya /menu olabilir.');
}

const nextConfig: NextConfig = {
  output: 'standalone',
  // Cloud build bos degerle mevcut /[slug] linklerini aynen korur. Windows
  // local artifact'i build edilirken MENU_BASE_PATH=/menu acikca verilmelidir.
  basePath: menuBasePath,
  outputFileTracingRoot: path.resolve(__dirname, '../..'),
  turbopack: {
    root: path.resolve(__dirname, '../..'),
  },
};

export default nextConfig;
