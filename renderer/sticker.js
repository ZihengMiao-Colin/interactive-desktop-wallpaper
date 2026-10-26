/**
 * sticker.js — 旧的自定义贴纸（将被自定义元素系统取代）
 */

'use strict';

class StickerManager {
    constructor() {
        this.container = document.getElementById('sticker-container');
        this.img = document.getElementById('sticker-img');
        this.config = null;
        this.currentPath = '';
    }

    setConfig(config) {
        this.config = config;
        if (!this.container || !this.img) return;

        if (!config || !config.enabled || !config.imagePath) {
            this.container.style.display = 'none';
            return;
        }

        // 加载贴纸图片
        if (this.currentPath !== config.imagePath) {
            this.currentPath = config.imagePath;
            if (isElectron && window.electronAPI) {
                const dataUrl = window.electronAPI.readFileAsDataURL(config.imagePath);
                if (dataUrl) {
                    this.img.src = dataUrl;
                } else {
                    this.img.src = config.imagePath;
                }
            } else {
                this.img.src = config.imagePath;
            }
        }

        this.container.style.display = 'block';
        this.container.style.width = (config.size || 180) + 'px';
        this.container.style.opacity = config.opacity !== undefined ? config.opacity : 0.9;
    }

    update(mouseX, mouseY) {
        if (!this.container || !this.config || !this.config.enabled || !this.config.imagePath) return;

        const posX = (window.innerWidth * (this.config.positionX !== undefined ? this.config.positionX : 85)) / 100;
        const posY = (window.innerHeight * (this.config.positionY !== undefined ? this.config.positionY : 20)) / 100;

        // 根据所选深度计算视差位移
        const diff = (this.config.depth !== undefined ? this.config.depth : 0.7) - (CONFIG.focusDepth !== undefined ? CONFIG.focusDepth : 0.5);
        const offsetX = -mouseX * diff * (CONFIG.parallaxMultiplier * 1.5);
        const offsetY = -mouseY * diff * (CONFIG.parallaxMultiplier * 1.5);

        this.container.style.left = `${posX + offsetX}px`;
        this.container.style.top = `${posY + offsetY}px`;
    }
}
