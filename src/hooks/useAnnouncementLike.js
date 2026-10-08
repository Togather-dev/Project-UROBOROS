import {
  getAnnouncementLikeCount,
  getAnnouncementLikeStatus,
  likeAnnouncement,
} from "@/services/AnnouncementsService";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "./use-toast";

const useAnnouncementLike = (announcement_id, user_id) => {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const addLikeMutation = useMutation({
    mutationFn: likeAnnouncement,
    onError: (error) => {
      toast({
        title: "Something went wrong",
        description: `${error.message}`,
      });
    },
    onSettled: () => {
      queryClient.invalidateQueries({
        queryKey: ["announcementLikeCount", announcement_id],
      });
      queryClient.invalidateQueries({
        queryKey: ["announcementLikeStatus", announcement_id, user_id],
      });
    },
  });

  const { data } = useQuery({
    queryKey: ["announcementLikeStatus", announcement_id, user_id],
    queryFn: () => getAnnouncementLikeStatus({ announcement_id, user_id }),
    enabled: !!user_id && !!announcement_id,
  });

  const { data: likeCount } = useQuery({
    queryKey: ["announcementLikeCount", announcement_id],
    queryFn: () => getAnnouncementLikeCount({ announcement_id }),
    enabled: !!announcement_id,
  });

  return { addLikeMutation, data, likeCount };
};

export default useAnnouncementLike;
