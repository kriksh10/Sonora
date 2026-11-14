import { useEffect, useState } from 'react';

const mediaPath = `${import.meta.env.BASE_URL.replace(/\/$/, '')}/media`;
const description = 'Sonora showing a live meeting transcript and a suggested answer';

export default function HomepageDemo() {
  const [reducedMotion, setReducedMotion] = useState(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );

  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReducedMotion(preference.matches);
    update();
    preference.addEventListener('change', update);
    return () => preference.removeEventListener('change', update);
  }, []);

  return (
    <figure className="sm-demo">
      <div className="sm-demo-frame">
        {reducedMotion ? (
          <img src={`${mediaPath}/homepage-demo-poster.jpg`} alt={description} width={1280} height={752} />
        ) : (
          <video
            autoPlay
            muted
            loop
            playsInline
            controls={false}
            disablePictureInPicture
            preload="metadata"
            poster={`${mediaPath}/homepage-demo-poster.jpg`}
            width={1280}
            height={752}
            aria-label={description}
          >
            <source src={`${mediaPath}/homepage-demo.webm`} type="video/webm" />
            <source src={`${mediaPath}/homepage-demo.mp4`} type="video/mp4" />
            <img src={`${mediaPath}/homepage-demo-poster.jpg`} alt={description} width={1280} height={752} />
          </video>
        )}
      </div>
      <figcaption>Real Sonora app, demo conversation.</figcaption>
    </figure>
  );
}
