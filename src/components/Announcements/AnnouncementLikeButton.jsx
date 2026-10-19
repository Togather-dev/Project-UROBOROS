import { LikeIcon } from "@/assets/icons/icons";
import useAnnouncementLike from "@/hooks/useAnnouncementLike";
import { cn } from "@/lib/utils";
import PropTypes from "prop-types";

const AnnouncementLikeButton = ({ className, announcement_id, user_id }) => {
  const { data, addLikeMutation, likeCount } = useAnnouncementLike(
    announcement_id,
    user_id
  );

  return (
    <button
      disabled={addLikeMutation?.isPending}
      onClick={() => addLikeMutation?.mutate({ announcement_id, user_id })}
      className={className}
    >
      <div
        className={cn(
          "flex items-center justify-center rounded-3xl bg-primary p-1",
          { "bg-blue": data?.isLiked }
        )}
      >
        <LikeIcon
          className={cn("h-5 w-5 text-accent opacity-70", {
            "text-white opacity-100": data?.isLiked,
          })}
        />

        <p
          className={cn("text-xs text-accent opacity-70", {
            "text-white opacity-100": data?.isLiked,
          })}
        >
          {likeCount}
        </p>
      </div>
    </button>
  );
};

AnnouncementLikeButton.propTypes = {
  className: PropTypes.string.isRequired,
  announcement_id: PropTypes.oneOfType([PropTypes.string, PropTypes.number])
    .isRequired,
  user_id: PropTypes.oneOfType([PropTypes.string, PropTypes.number]).isRequired,
};

export default AnnouncementLikeButton;
