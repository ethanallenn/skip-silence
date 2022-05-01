import { browser } from "webextension-polyfill-ts";
import { MediaElement } from '../types';
import debug from '../debug';
import ConfigProvider from '../configProvider';
import DynamicThresholdCalculator from "./DynamicThresholdCalculator";
import AudioSync from "./AudioSync";
import Statistics from "./Statistics";
import createAudioContextSecure from "./AudioContext";
import { attachSkipperToElement } from "./Utils";
import SpeedController from "./SpeedController";
import SampleInspector from "./SampleInspector";
import BackgroundMediaLoader from "./BackgroundMediaLoader";

/**
 * Silence Skipper: This class is doing the job of actually inspecting media elements and
 * slowing them up or down
 */
export default class SilenceSkipper {
  // Constructor variables
  element : MediaElement;
  preloadElement ?: MediaElement;
  config : ConfigProvider;

  // State variables
  isAttached = false;
  isSpedUp = false;
  samplesSinceLastVolumeMessage = 0;

  // Audio variables
  audioContext : AudioContext | undefined;
  analyser : AnalyserNode | undefined;
  gain : GainNode | undefined;
  source: MediaElementAudioSourceNode | undefined;
  audioFrequencies : Float32Array | undefined;

  // Dependencies
  dynamicThresholdCalculator : DynamicThresholdCalculator;
  audioSync : AudioSync;
  statistics : Statistics;
  speedController : SpeedController;
  sampleInspector : SampleInspector;
  backgroundMediaLoader: BackgroundMediaLoader;

  /**
   * Add silence skipper to element
   * 
   * @param mediaElement Element to attach to
   * @param config Config Provider to use
   */
  constructor(mediaElement : MediaElement, config : ConfigProvider) {
    this.element = mediaElement;
    this.config = config;

    // Setup dependencies
    this.dynamicThresholdCalculator = new DynamicThresholdCalculator(config);
    this.audioSync = new AudioSync(this);
    this.statistics = new Statistics(this);
    this.speedController = new SpeedController(this);
    this.sampleInspector = new SampleInspector(this);
    this.backgroundMediaLoader = new BackgroundMediaLoader(this);

    // Attach our config listener
    this.config.onUpdate(() => this._onConfigUpdate());

    // Initial update to setup current config
    this._onConfigUpdate();
  }

  /**
   * Listener for config changes to update the settings
   */
  async _onConfigUpdate() {
    const isEnabled = this.config.get('enabled');
    browser.runtime.sendMessage({
      command: 'tabEnabledInfo',
      enabled: isEnabled,
    })
    console.log(`Silence Skipper is ${isEnabled ? 'enabled' : 'disabled'}`);

    if (isEnabled) {
      if (this.config.get('use_preload') && this.config.get('can_use_preload') && this.config.env !== 'background') {
        // Use background media
        debug('SilenceSkipper: Using background media', this.backgroundMediaLoader.mediaId);
        if (!this.backgroundMediaLoader.mediaId && !this.backgroundMediaLoader.isLoadingMedia) {
          const canUseMedia = await this.backgroundMediaLoader.createBackgroundMediaElement();
          if (!canUseMedia) {
            this.config.set('can_use_preload', false);
          }
        }
      } else {
        // Use direct media
        if (!this.sampleInspector.isInspectionRunning) {
          // Start running the inspection
          this.sampleInspector.inspectSample();
        }
  
        // Update our speed to the new config speed
        const playbackSpeed = this.config.get('playback_speed');
        const silenceSpeed = this.config.get('silence_speed');
        if (this.isSpedUp) {
          this.speedController.setPlaybackRate(silenceSpeed);
        } else {
          this.speedController.setPlaybackRate(playbackSpeed);
        }
  
        // Update gain level
        const muteSilence = this.config.get("mute_silence");
        if(muteSilence && this.isSpedUp) {
          if (this.gain) {
            // Make sure our silence is muted 
            this.gain.gain.value = 0;
          }
        } else if (this.gain) {
          // Make sure we are not muted 
          this.gain.gain.value = 1;
        }
      }
    }
  }

  /**
   * Send a command to the popup
   * 
   * @param command Command to send
   * @param data Additional data to send (optional)
   */
  _sendCommand(command : String, data : Object = {}) {
    browser.runtime.sendMessage({ command, ...data });
  }
}