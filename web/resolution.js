import {StudioError} from './i18n.js';

const GRID=32;
const MAX_DIMENSION=16384;
export const ASPECT_RATIOS=['1:1','2:3','3:2','3:4','4:3','9:16','16:9','21:9'];

export function roundEven(n){
  const floor=Math.floor(n),fraction=n-floor;
  return Math.abs(fraction-.5)<1e-10?(floor%2?floor+1:floor):Math.round(n);
}

const aligned=value=>Math.max(GRID,roundEven(value/GRID)*GRID);
export const validDimension=value=>Number.isInteger(value)&&value>=GRID&&value<=MAX_DIMENSION&&value%GRID===0;

export function dimensionAspect(width,height){
  let a=width,b=height;
  while(b)[a,b]=[b,a%b];
  return `${width/a}:${height/a}`;
}

export function imageAspectFromDimensions(width,height){
  if(![width,height].every(n=>Number.isSafeInteger(n)&&n>0))throw new StudioError('imageSizeReadError');
  return dimensionAspect(width,height);
}

export function resolutionAspect({aspect,image_aspect,image_size}){
  if(ASPECT_RATIOS.includes(aspect))return aspect;
  if(aspect!=='image')throw new StudioError('invalidResolution');
  if(image_aspect===undefined){
    const {width,height}=image_size??{};
    if(validDimension(width)&&validDimension(height))return dimensionAspect(width,height);
  }
  if(typeof image_aspect!=='string'||!/^[1-9][0-9]{0,9}:[1-9][0-9]{0,9}$/.test(image_aspect)||image_aspect.trim()!==image_aspect)throw new StudioError('invalidImageSize');
  return image_aspect;
}

export function resolutionSize(value){
  const {source,megapixels}=value??{};
  if(!['studio','engine'].includes(source)||!Number.isFinite(megapixels)||megapixels<.01||megapixels>16)throw new StudioError('invalidResolution');
  const [a,b]=resolutionAspect(value).split(':').map(Number);
  const width=aligned(Math.sqrt(megapixels*1e6*a/b)),height=aligned(Math.sqrt(megapixels*1e6*b/a));
  if(!validDimension(width)||!validDimension(height))throw new StudioError('imageAspectLimit');
  return {width,height};
}
