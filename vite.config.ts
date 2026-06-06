import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base: './' 로 상대 경로를 사용하면 GitHub Pages 프로젝트 페이지
// (https://<user>.github.io/<repo>/) 에서도 자산 경로가 깨지지 않습니다.
export default defineConfig({
  base: './',
  plugins: [react()],
})
