(() => {
  "use strict";

  window.createConversationFollower = (messages, prompt, threshold = 120) => {
    let following = true;
    const nearBottom = () => messages.scrollHeight - messages.scrollTop - messages.clientHeight < threshold;
    const setFollowing = value => {
      following = value;
      prompt.hidden = value;
    };
    const scrollToLatest = () => {
      messages.scrollTop = messages.scrollHeight;
      setFollowing(true);
    };
    const followMediaGrowth = event => {
      if (following && event.target.matches("img, video")) requestAnimationFrame(scrollToLatest);
    };

    messages.addEventListener("scroll", () => setFollowing(nearBottom()), { passive: true });
    messages.addEventListener("load", followMediaGrowth, true);
    messages.addEventListener("loadedmetadata", followMediaGrowth, true);
    prompt.addEventListener("click", scrollToLatest);

    return {
      isFollowing: () => following,
      nearBottom,
      scrollToLatest,
      setFollowing,
    };
  };
})();
