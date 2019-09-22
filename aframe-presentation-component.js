// Original source: https://github.com/rvdleun/aframe-presentation-component
AFRAME.registerComponent('presentation', {
    schema: {
        camera: { type: 'selector', default: '[camera]' },
        emitEventsOnScene: { type: 'boolean', default: false },
        keyboardShortcuts: { type: 'boolean', default: true },
        useHash: { type: 'boolean', default: true },
    },

    currentSlide: 0,
    slides: [],

    init: function() {
        this.slides = this.el.querySelectorAll('[presentation-slide]');

        if (this.data.keyboardShortcuts) {
            document.addEventListener('keyup', (e) => this._onKey(e));
        }

        this.changeSlide(this.data.useHash && window.location.hash ? window.location.hash.substring(1) : '0', true);

        for (let i = 0; i < this.currentSlide; i++) {
            this._playAnimation(i, 'to');
            this._setupEntityVisibility(i, false);
        }

        this._playAnimation(this.currentSlide, 'to');
    },

    changeSlide: function(dir, instant) {
        const camera = this.data.camera;
        const prevSlide = this.slides[this.currentSlide];
        const prevPos = prevSlide.components['presentation-slide'].data.cameraPosition;
        const prevRot = prevSlide.components['presentation-slide'].data.cameraRotation;

        this.currentSlide = Math.max(0, Math.min(this.slides.length - 1, this.currentSlide + dir));
        const currentSlide = this.slides[this.currentSlide];
        const curPos = currentSlide.components['presentation-slide'].data.cameraPosition;
        const curRot = currentSlide.components['presentation-slide'].data.cameraRotation;

        const duration = currentSlide.components['presentation-slide'].data.cameraDuration;

        if (instant) {
            camera.setAttribute('position', curPos);
            camera.setAttribute('rotation', curRot);
        } else {
            camera.setAttribute('animation__position', `property: position; dur: ${duration}; easing: linear; from: ${prevPos.x} ${prevPos.y} ${prevPos.z}; to: ${curPos.x} ${curPos.y} ${curPos.z}`);
            camera.setAttribute('animation__rotation', `property: rotation; dur: ${duration}; easing: linear; from: ${prevRot.x} ${prevRot.y} ${prevRot.z}; to: ${curRot.x} ${curRot.y} ${curRot.z}`);
        }

        const emitEvent = currentSlide.components['presentation-slide'].data.emitEvent;
        if (emitEvent) {
            const el = this.data.emitEventsOnScene ? this.el.sceneEl : this.el;
            el.dispatchEvent(new Event(emitEvent));
        }

        this._pauseAnimation(this.currentSlide);
        this._playAnimation(this.currentSlide);
        this._setupEntityVisibility(this.currentSlide, dir === -1);

        if (this.data.useHash) {
            window.location.hash = this.currentSlide.toString();
        }
    },

    previousSlide: function() {
        if (this.currentSlide === 0) {
            return;
        }

        this._playAnimation(this.currentSlide, 'prev');
        this._setupEntityVisibility(this.currentSlide, true);
        this.changeSlide(-1);
    },

    nextSlide: function() {
        if (this.currentSlide === this.slides.length - 1) {
            return;
        }

        this.changeSlide(1);
        this._playAnimation(this.currentSlide, 'play');
    },

    _playAnimation: function(slideNo, action) {
        const slide = this.slides[slideNo];
        const animations = slide.components['presentation-slide'].data.animationsStart.map((animation) => `__${animation}`);
        const selector = slide.components['presentation-slide'].data.animationsClass;

        if (!selector) {
            return;
        }

        const elements = [].slice.call(document.querySelectorAll(`.${selector}`));
        elements.forEach((element) => {
            animations.forEach((animation) => {
                const component = element.components[`animation${animation}`];
                if (!component) {
                    return;
                }

                switch(action) {
                    case 'from':
                    case 'to':
                        const property = component.data.property;
                        const to = component.data[action];

                        element.setAttribute(property, to);
                        break;

                    case 'prev':
                        element.setAttribute(`animation${animation}`, 'dir', 'reverse');
                        component.beginAnimation();
                        break;

                    case 'play':
                        element.setAttribute(`animation${animation}`, 'dir', '');
                        component.beginAnimation();
                        break;
                }
            });
        });
    },

    _pauseAnimation: function(slideNo) {
        const slide = this.slides[slideNo];
        const animations = slide.components['presentation-slide'].data.animationsStart.map((animation) => `__${animation}`);
        const selector = slide.components['presentation-slide'].data.animationsClass;

        if (!selector) {
            return;
        }

        const elements = [].slice.call(document.querySelectorAll(selector));
        elements.forEach((element) => {
            animations.forEach((animation) => {
                const component = element.components[`animation${animation}`];
                if (!component) {
                    return;
                }

                component._pauseAnimation();
            })
        })
    },

    _setupEntityVisibility: function(slideNo, reverse) {
        const slide = this.slides[slideNo];
        const data = slide.components['presentation-slide'].data;

        data.hideEntities.forEach((selector) => {
            document.querySelectorAll(selector).forEach((el) => {
                el.setAttribute('visible', reverse);
            });
        });

        data.showEntities.forEach((selector) => {
            document.querySelectorAll(selector).forEach((el) => {
                el.setAttribute('visible', !reverse);
            });
        });
    },

    _onKey: function(event) {
        switch(event.code) {
            case 'ArrowLeft':
                this.previousSlide();
                break;

            case 'ArrowRight':
                this.nextSlide();
                break;
        }
    }
});

AFRAME.registerComponent('presentation-slide', {
    schema: {
        animationsClass: { type: 'string' },
        animationsPause: { type: 'array', default: [''] },
        animationsStart: { type: 'array', default: [''] },
        cameraDuration: { type: 'number', default: 1000, },
        cameraPosition: { type: 'vec3' },
        cameraRotation: { type: 'vec3' },
        emitEvent: { type: 'string' },
        emitValues: { type: 'array', default: [] },
        hideEntities: { type: 'array', default: [] },
        showEntities: { type: 'array', default: [] },
    },
});

AFRAME.registerPrimitive('a-presentation', {
    defaultComponents: {
        'presentation': {},
    },

    mappings: {
        'camera': 'presentation.camera',
        'keyboard-shortcuts': 'presentation.keyboardShortcuts',
        'use-hash': 'presentation.useHash',
    }
});

AFRAME.registerPrimitive('a-presentation-slide', {
    defaultComponents: {
        'presentation-slide': {},
    },

    mappings: {
        'animations-class': 'presentation-slide.animationsClass',
        'animations-pause': 'presentation-slide.animationsPause',
        'animations-start': 'presentation-slide.animationsStart',
        'camera-duration': 'presentation-slide.cameraDuration',
        'camera-position': 'presentation-slide.cameraPosition',
        'camera-rotation': 'presentation-slide.cameraRotation',
        'emit-event': 'presentation-slide.emitEvent',
        'emit-values': 'presentation-slide.emitValues',
        'hide-entities': 'presentation-slide.hideEntities',
        'show-entities': 'presentation-slide.showEntities',
    }
});
