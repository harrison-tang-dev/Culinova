import {
  findUserByEmail,
  findUserById,
  returnUser,
} from "../utils/helpers/authlogin.js";
import { userdb, Gusers } from "../models/users/userSchema.js";
import {
  uploadToS3,
  updateToS3,
  deleteFromS3,
} from "../utils/helpers/s3func.js";
import { Members } from "../models/users/members.js";
import { Posts } from "../models/community/posts.js";
import { onBoarding } from "../models/appsettings/onboarding.js";
import { AppSecrets } from "../models/appsettings/secrets.js";
import { Pages } from "../models/pages/pages.js";
import { Image } from "../models/users/Imagesdir.js";
import { sendPushNotificationToAllUsers } from "../utils/helpers/sendpushNotification.js";
import { UserAnnouncement, Announcement } from "../models/Admin/anouncemnet.js";
import bcrypt from "bcrypt";

export const dashService = {
  getUsers: async (
    userId,
    { page = 1, limit = 10, email, isEmailValidated, roles, name, searchemail }
  ) => {
    let query = {};

    if (email) {
      query.email = email;
    }

    if (typeof isEmailValidated !== "undefined") {
      query.isEmailValidated = JSON.parse(isEmailValidated);
    }

    if (roles) {
      query.roles = { $in: roles };
    }

    if (name) {
      query.name = new RegExp(name, "i"); // Case-insensitive regex search
    }

    if (searchemail) {
      query.email = new RegExp(searchemail, "i"); // Case-insensitive regex search
    }

    // Handling email search
    if (email) {
      const user = await findUserByEmail(email);
      const guser = await Gusers.findOne({ email });

      if (!user && !guser) {
        return {
          currentPage: page,
          totalPages: 1,
          data: [],
          message: "User not found",
        };
      }

      const data = [];
      if (user) data.push(await returnUser(user));
      if (guser) data.push(await returnUser(guser));

      return {
        currentPage: 1,
        totalPages: 1,
        data,
      };
    } else {
      // Fetch users from both collections
      const users = await userdb.find(query).lean();
      const gusers = await Gusers.find(query).lean();

      // Combine both user arrays
      const combinedUsers = [...users, ...gusers];

      // Sort combined users by creation date (assuming `createdAt` field exists in both collections)
      const sortedUsers = combinedUsers.sort(
        (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
      );

      // Calculate pagination
      const totalUsers = sortedUsers.length;
      const paginatedUsers = sortedUsers.slice(
        (page - 1) * limit,
        page * limit
      );

      // Map to returnUser format
      const result = await Promise.all(
        paginatedUsers.map(async (user) => await returnUser(user))
      );

      return {
        currentPage: page,
        totalPages: Math.ceil(totalUsers / limit),
        data: result,
      };
    }
  },

  getAllUsers: async () => {
    const users = await userdb.find();
    const gusers = await Gusers.find();
    const combinedUsers = [...users, ...gusers];

    // Process each user with the returnUser function
    let result = await Promise.all(
      combinedUsers.map(async (user) => await returnUser(user))
    );

    // Sort the result by the 'createdAt' field in descending order (most recent first)
    result.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    return result;
  },

  changeArroveStatus: async (userid) => {
    const user = await userdb.findById(userid);
    if (!user) return { success: false, message: "User not found" };
    user.approvedStatus = !user.approvedStatus;
    await user.save();
    return {
      success: true,
      message: " Status updated",
      isBlock: !user.approvedStatus,
    };
  },

  getComments: async (userId, { page = 1, limit = 10 }) => {
    try {
      // Calculate the number of documents to skip
      const skip = (page - 1) * limit;

      // Find all posts
      const posts = await Posts.find().sort({ createdAt: -1 });

      // Extract all comments from the posts
      let allComments = [];
      for (const post of posts) {
        const commentsWithPostId = post.comments.map((comment) => ({
          ...comment.toObject(),
          postId: post._id,
          createdAt: comment.createdAt, // Ensure createdAt is included for sorting
        }));

        // Update each comment's name using the latest user data
        for (let comment of commentsWithPostId) {
          let user = await userdb.findOne({ _id: comment.userId });
          if (!user) {
            user = await Gusers.findOne({ _id: comment.userId });
          }
          comment.name = user ? user.name : comment.name;
        }

        allComments = allComments.concat(commentsWithPostId);
      }

      // Sort all comments by createdAt in descending order (latest first)
      allComments.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

      // Paginate the comments
      const paginatedComments = allComments.slice(skip, skip + limit);

      // Calculate the total number of comments and pages
      const totalComments = allComments.length;
      const totalPages = Math.ceil(totalComments / limit);

      // Return the paginated comments with pagination info
      return {
        success: true,
        message: "Comments data retrieved",
        comments: paginatedComments,
        totalComments,
        totalPages,
        currentPage: page,
        limit,
      };
    } catch (error) {
      return { success: false, message: "Error retrieving comments", error };
    }
  },

  deleteComments: async (userId, { postId, commentId }) => {
    // Find the post by postId
    const post = await Posts.findById(postId);

    if (!post) {
      return {
        success: false,
        message: "Post not found",
      };
    }

    // Find the index of the comment to be deleted
    const commentIndex = post.comments.findIndex(
      (comment) => comment._id.toString() === commentId
    );

    if (commentIndex === -1) {
      return {
        success: false,
        message: "Comment not found",
      };
    }

    // Remove the comment from the array
    post.comments.splice(commentIndex, 1);

    // Save the updated post
    await post.save();

    return {
      success: true,
      message: "Comment deleted successfully",
    };
  },

  getMembers: async (userId, { page, limit, email }) => {
    page = page || 1;
    limit = limit || 10;
    let Membersdata;

    if (email) {
      Membersdata = await Members.findOne(
        { email: email },
        { refreshtoken: 0, password: 0 }
      ).sort({ createdAt: -1 });
      if (!Membersdata) {
        return {
          currentPage: page,
          totalPages: 1,
          data: [],
          message: "User not found",
        };
      }

      // Fetch images for the user
      // const images = await Image.find({ userId: Membersdata._id.toString() });
      const memberWithImages = {
        ...(await returnUser(Membersdata)),
        // images: images.map(img => (`/images/${img._id}`)),
      };

      return {
        currentPage: 1,
        totalPages: 1,
        data: [memberWithImages],
      };
    } else {
      Membersdata = await Members.find()
        .skip((page - 1) * limit)
        .limit(Number(limit))
        .sort({ createdAt: -1 });

      // Fetch images for all members
      const memberIds = Membersdata.map((member) => member._id);
      // const images = await Image.find({ userId: { $in: memberIds } });
      // // Group images by userId
      // const imageMap = images.reduce((acc, img) => {
      //   if (!acc[img.userId]) {
      //     acc[img.userId] = [];
      //   }
      //   acc[img.userId].push(`/images/${img._id}`);
      //   return acc;
      // }, {});

      const result = await Promise.all(
        Membersdata.map(async (user) => {
          const userWithImages = {
            ...(await returnUser(user)),
            // images: imageMap[user._id] || [],
          };
          return userWithImages;
        })
      );

      const totalUsers = await Members.countDocuments();

      return {
        currentPage: page,
        totalPages: Math.ceil(totalUsers / limit),
        data: result,
      };
    }
  },

  GetAllPost: async (userId, { type, page = 1, limit = 10, name, title }) => {
    const skip = (page - 1) * limit;

    // Fetch posts based on type
    let postQuery = {};
    if (type === "liked") {
      postQuery = { "likes.userId": userId };
    }

    if (title) {
      postQuery.title = { $regex: title, $options: "i" }; // Case-insensitive match for title
    }
    if (name) {
      postQuery.name = { $regex: name, $options: "i" }; // Case-insensitive match for name
    }

    // Retrieve posts with pagination and sorting, converting to plain objects
    const postdata = await Posts.find(postQuery)
      .skip(skip)
      .limit(limit)
      .sort({ createdAt: -1 })
      .lean();

    // Count the total number of posts for the given query (without pagination)
    const totalPosts = await Posts.countDocuments(postQuery);

    // If no posts found
    if (!postdata.length) {
      return {
        currentPage: page,
        totalPages: Math.ceil(totalPosts / limit),
        post: [],
        message: "No posts found",
        success: true,
        limit,
      };
    }

    // Extract unique userIds from posts
    const userIds = [
      ...new Set(postdata.map((post) => post.userId.toString())),
    ];

    // Fetch user data from both userdb and Gusers collections
    const [userdbUsers, gusers] = await Promise.all([
      userdb
        .find({ _id: { $in: userIds } })
        .select("name profileurl")
        .lean(),
      Gusers.find({ _id: { $in: userIds } })
        .select("name profileurl")
        .lean(),
    ]);

    // Combine and map user data
    const userMap = [...userdbUsers, ...gusers].reduce((acc, user) => {
      acc[user._id.toString()] = {
        name: user.name,
        profileImageUrl: user.profileurl,
      };
      return acc;
    }, {});

    // Extract unique postIds
    const postIds = postdata.map((post) => post._id.toString());

    // Fetch images related to posts
    const images = await Image.find({
      postId: { $in: postIds },
      userId,
    }).lean();
    const imageMap = images.reduce((acc, image) => {
      if (!acc[image.postId.toString()]) {
        acc[image.postId.toString()] = [];
      }
      acc[image.postId.toString()].push(`/images/${image._id}`);
      return acc;
    }, {});

    // Format posts with user and image data
    const post = postdata.map((post) => {
      const isLiked = post.likes.some(
        (like) => like.userId.toString() === userId.toString()
      );
      const userInfo = userMap[post.userId.toString()] || {};

      // Attach profile image URL and post images
      const postImages = imageMap[post._id.toString()] || [];
      const commentsWithProfileImages = post.comments.map((comment) => {
        const commentUserInfo = userMap[comment.userId.toString()] || {};
        return {
          ...comment,
          profileImageUrl: commentUserInfo.profileImageUrl || "",
        };
      });

      return {
        _id: post._id,
        userId: post.userId,
        title: post.title,
        name: post.name,
        username: userInfo.username,
        caption: post.caption,
        message: post.message,
        postimage: post.postimage,
        likeCount: post.likeCount,
        approved: post.approved,
        likes: post.likes,
        comments: commentsWithProfileImages,
        createdAt: post.createdAt,
        updatedAt: post.updatedAt,
        liked: isLiked,
        profileImageUrl: userInfo.profileImageUrl || "",
      };
    });

    return {
      currentPage: page,
      totalPages: Math.ceil(totalPosts / limit),
      post,
      message: "Posts data retrieved",
      success: true,
      limit,
    };
  },

  UpdateFamilyMember: async (
    adminId,
    { name, email, phonenumber, relationship, updateduserId },
    profilepic,
    userId
  ) => {
    let filepath, member;
    member = await Members.findOne({ email: email });

    if (profilepic && member.profileurl) {
      filepath = await updateToS3(member.profileurl, profilepic);
    } else if (profilepic) {
      filepath = await uploadToS3(profilepic);
    }

    (member.userId = updateduserId), (member.name = name);
    member.phonenumber = phonenumber;
    member.profileurl = filepath?.Location;
    member.relationship = relationship;

    await member.save();

    return {
      message: "Member profile updated successfuly",
      success: true,
    };
  },

  AddUser: async (
    userId,
    {
      name,
      email,
      postcode,
      phonenumber,
      countryCode,
      Dob,
      aboutme,
      BMI,
      Age,
      allergies,
      gender,
      health_conditions,
      weight,
      Unit,
      ft,
      In,
      Unit2,
      roles,
      userpassword,
    },
    profilepic
  ) => {
    let filepath;
    let uservalid = await userdb.findOne({ email: email });
    if (!uservalid) {
      uservalid = await Gusers.findOne({ email: email });
    }
    if (uservalid) {
      throw {
        status: 403,
        message: "User already exists",
      };
    } else {
      // const hashedPassword = await bcrypt.hash(userpassword, 10);
      const newuser = new userdb({
        name: name,
        email: email,
        phonenumber: phonenumber,
        age: Age,
        dob: Dob,
        aboutme: aboutme,
        countryCode: countryCode,
        weight: weight,
        Unit: Unit,
        ft: ft,
        In: In,
        Unit2: Unit2,
        health_conditions: health_conditions,
        allergies: allergies,
        gender: gender,
        password: userpassword,
        profileurl: "",
        roles,
      });

      await newuser.save();

      filepath = await uploadToS3(profilepic);

      newuser.profileurl = filepath?.Location;
      newuser.save();

      const user = await returnUser(newuser);
      return {
        user,
        message: "User Added successfully",
        success: true,
      };
    }
  },

  // Helper function to delete posts and associated images
  deleteUserPostsAndImages: async (userProfileId) => {
    // Find all posts by the user
    const posts = await Posts.find({ userId: userProfileId });

    for (const post of posts) {
      // Assuming a function deleteImageFromS3 exists to delete images from S3
      await deleteImageFromS3(post?.postimage);
      // // Delete image record from Images collection
      // await Image.findOneAndDelete({ _id: image._id });
    }

    // Delete all posts by the user
    await Posts.deleteMany({ userId: userProfileId });
  },

  DeleteUser: async (userProfileId) => {
    // Check in userdb collection
    let result = await userdb.findOne({ _id: userProfileId });
    if (result) {
      // Delete the user from userdb
      await userdb.findOneAndDelete({ _id: userProfileId });

      // Delete the user's posts
      await dashService.deleteUserPostsAndImages(userProfileId);

      return {
        success: true,
        message: "User and associated posts deleted successfully",
      };
    }

    // Check in Gusers collection
    result = await Gusers.findById(userProfileId);
    if (result) {
      // Delete the user from Gusers
      await Gusers.findOneAndDelete({ _id: userProfileId });

      // Delete the user's posts
      await dashService.deleteUserPostsAndImages(userProfileId);

      return {
        success: true,
        message: "User and associated posts deleted successfully.",
      };
    }

    // If user not found in either collection
    return {
      success: false,
      message: "User does not exist",
    };
  },

  DeleteUserProfile: async ({ email, password }) => {
    // Check in userdb collection
    let result = await userdb.findOne({ email: email });
    if (result) {
      await userdb.findOneAndDelete({ email: email });
      // Delete the user's posts
      await dashService.deleteUserPostsAndImages(userProfileId);
      return {
        success: true,
        message: "User deleted successfully",
      };
    }

    // Check in Gusers collection
    result = await Gusers.findOne(email);
    if (result) {
      await Gusers.findOneAndDelete({ email: email });
      // Delete the user's posts
      await dashService.deleteUserPostsAndImages(userProfileId);
      return {
        success: true,
        message: "User deleted successfully",
      };
    }

    // If user not found in either collection
    return {
      success: false,
      message: "User does not exist",
    };
  },

  AddPosts: async (userId, { name, title, caption, message, email }, file) => {
    let filepath;
    const user = await findUserByEmail(email);
    const post = new Posts({
      userId: user._id,
      name: name,
      caption: caption,
      message: message,
      title: title,
      postimage: "",
      approved: true,
    });
    await post.save();

    if (post && file) {
      filepath = await uploadToS3(file);
      post.postimage = filepath?.Location;
      await post.save();
    }

    try {
      // await sendPushNotificationToAllUsers(
      //   "SafePlate",
      //   "A new post has been added ✨"
      // );
    } catch (error) {
      console.error("Error sending notifications:", error);
    }
    return { message: "Post Successfully added", success: true, post };
  },

  UpdatePostStatus: async (userId, { status }, { postid }) => {
    const post = await Posts.findById(postid);

    if (!post) {
      return {
        success: false,
        message: "Post not found",
      };
    }

    // Check if the status needs to be toggled
    const newStatus = post.approved == status ? !status : status;

    // Update the post's approved status
    post.approved = newStatus;

    // Save the updated post
    await post.save();

    return {
      success: true,
      message: "Post status updated successfully",
      post: {
        _id: post._id,
        approved: post.approved,
      },
    };
  },

  UpdatePost: async (userId, data, { postid }, file) => {
    // Find the post by ID
    const post = await Posts.findById(postid);
    const user = await findUserById(post?.userId);

    // If post not found, return an error response
    if (!post) {
      return {
        success: false,
        message: "Post not found",
      };
    }
    post.userId = data.userId;
    post.name = data?.name;
    post.caption = data?.caption;
    post.message = data?.message;
    post.title = data?.title;
    post.approved = data?.approved;

    // Handle file upload if a file is provided
    if (file) {
      const result = await updateToS3(post?.postimage, file);
      post.postimage = result?.Location; // Set the image URL or other relevant data
    }

    // Save the updated post
    await post.save();

    return {
      success: true,
      message: "Post updated successfully",
      post: {
        _id: post._id,
        ...data, // Include updated data in the response
        postimage: post.postimage, // Include updated image if applicable
      },
    };
  },

  SetupOnboarding: async (userId, bodydata, filedata) => {
    try {
      // 1. Save the images in the Image collection and get their URLs/IDs
      const imageUrls = {};
      const user = await findUserById(userId);

      for (const [key, file] of Object.entries(filedata)) {
        const result = await uploadToS3(file);
        // Save the image URL (or ID) to be used in the onboarding data
        imageUrls[key] = result?.Location;
      }

      // 2. Prepare the onboarding data with image URLs
      const onboardingData = {
        onboarding1: {
          icon: imageUrls["onboarding1.icon"], // Use the saved image URL
          headertext: bodydata["onboarding1.headertext"].trim(),
          caption: bodydata["onboarding1.caption"].trim(),
          color: bodydata["onboarding1.color"].trim(),
        },
        onboarding2: {
          icon: imageUrls["onboarding2.icon"],
          headertext: bodydata["onboarding2.headertext"].trim(),
          caption: bodydata["onboarding2.caption"].trim(),
          color: bodydata["onboarding2.color"].trim(),
        },
        onboarding3: {
          icon: imageUrls["onboarding3.icon"],
          headertext: bodydata["onboarding3.headertext"].trim(),
          caption: bodydata["onboarding3.caption"].trim(),
          color: bodydata["onboarding3.color"].trim(),
        },
      };

      // 3. Save or update the onboarding settings
      let settings = await onBoarding.findOne();

      if (!settings) {
        // If no existing settings, create new
        settings = new onBoarding({
          splashicon: imageUrls["splashicon"], // Use if you have splashicon in filedata
          appicon: imageUrls["appicon"], // Use if you have appicon in filedata
          applogo: imageUrls["applogo"], // Use if you have applogo in filedata
          onboarding: [
            { step: 1, data: onboardingData.onboarding1 },
            { step: 2, data: onboardingData.onboarding2 },
            { step: 3, data: onboardingData.onboarding3 },
          ],
        });

        await settings.save();
      } else {
        // Throw an error or handle an update scenario
        throw {
          status: false,
          message:
            "App Settings are already defined. You can try to update them",
        };
      }

      return {
        message: "App settings successfully added",
        success: true,
        settings,
      };
    } catch (error) {
      // Handle any errors that occur during the process
      return {
        message:
          error.message ||
          "An error occurred while setting up the onboarding data",
        success: false,
      };
    }
  },

  UpdateOnboarding: async (userId, updates) => {
    try {
      let settings = await onBoarding.findOne();
      const user = await findUserById(userId);

      if (!settings) {
        return {
          message: "Onboarding settings not found",
          success: false,
        };
      }

      // Update only the provided fields
      for (const key in updates) {
        if (key.startsWith("onboarding") && Number(key.slice(-1))) {
          const step = Number(key.slice(-1));
          const onboardingIndex = settings.onboarding.findIndex(
            (item) => item.step === step
          );

          if (onboardingIndex >= 0) {
            // Check if there's an icon to update
            if (updates[key].icon) {
              // Take the existing icon URL from the settings
              const existingIconUrl =
                settings.onboarding[onboardingIndex].data.icon;

              // Pass it to updateToS3 with user data
              const result = await updateToS3({
                existingIconUrl,
                ...updates[key].icon, // Pass the existing URL for update
              });

              // Update the icon URL in the settings with the new URL
              updates[key].icon = result?.Location; // Assume updateToS3 returns a URL in filedata
            }

            // Merge the updated fields with the existing onboarding data
            settings.onboarding[onboardingIndex].data = {
              ...settings.onboarding[onboardingIndex].data,
              ...updates[key],
            };
          } else {
            settings.onboarding.push({ step, data: updates[key] });
          }
        } else {
          settings[key] = updates[key];
        }
      }

      await settings.save();

      return {
        message: "Onboarding settings successfully updated",
        success: true,
        settings,
      };
    } catch (error) {
      throw {
        message: "Error updating onboarding settings",
        success: false,
        error: error.message,
      };
    }
  },

  deleteOnboarding: async (userId, { stepToDelete }) => {
    let settings = await onBoarding.findOne();

    if (!settings) {
      return {
        message: "Onboarding settings not found",
        success: false,
      };
    }

    // Filter out the onboarding step that matches the stepToDelete
    settings.onboarding = settings.onboarding.filter(
      (item) => item.step != stepToDelete
    );

    if (stepToDelete === "splashicon") {
      settings.splashicon = undefined;
    } else if (stepToDelete === "appicon") {
      settings.appicon = undefined;
    } else if (stepToDelete === "applogo") {
      settings.applogo = undefined;
    }

    await settings.save();

    return {
      message: `Onboarding step ${stepToDelete} successfully deleted`,
      success: true,
      settings,
    };
  },

  updateProfile: async (
    userId,
    {
      name,
      email,
      postcode,
      phonenumber,
      Dob,
      aboutme,
      BMI,
      Age,
      allergies,
      gender,
      health_conditions,
      weight,
      Unit,
      ft,
      In,
      Unit2,
      countryCode,
      others,
      roles,
      approve,
    },
    profilepic
  ) => {
    let filepath;
    let uservalid = await findUserByEmail(email);
    if (profilepic && uservalid.profileurl) {
      filepath = await updateToS3(uservalid.profileurl, profilepic);
    } else {
      filepath = await uploadToS3(profilepic);
    }
    uservalid.name = name;
    uservalid.countryCode = countryCode;
    uservalid.postcode = postcode;
    uservalid.phonenumber = phonenumber;
    uservalid.age = Age;
    uservalid.dob = Dob;
    uservalid.aboutme = aboutme;
    uservalid.bmi = BMI;
    uservalid.others = others;
    uservalid.health_conditions = health_conditions;
    uservalid.allergies = allergies;
    uservalid.gender = gender;
    uservalid.roles = roles;
    uservalid.profileurl = filepath?.Location;
    // if (approve) {
    //   uservalid.isEmailValidated = approve;
    // }

    await uservalid.save();

    const user = await returnUser(uservalid);
    return {
      user,
      message: "User profile updated successfully",
      success: true,
    };
  },

  AddSecrets: async (
    userId,
    {
      adminphonenumber,
      PushNotificationclientsecret,
      PushNotificationclientkeys,
      GoogleClientKeys,
      GeminiClientKeys,
      GoogleClientSecretKeys,
      AppleClientSecret,
      GeminiClientSecret,
      FBClientkeys,
      FBClientSecret,
      AppleClientKeys,
    },
    file
  ) => {
    // Find the user (assuming `findUserById` is a function that returns a user object)
    const user = findUserById(userId);

    // Extract files from the `file` object
    const { appicon, applogo } = file;

    // Upload images to S3
    let appIconUrl = "";
    let appLogoUrl = "";

    if (appicon) {
      const uploadAppIconResult = await uploadToS3(appicon);
      appIconUrl = uploadAppIconResult.Location;
    }

    if (applogo) {
      const uploadAppLogoResult = await uploadToS3(applogo);
      appLogoUrl = uploadAppLogoResult.Location;
    }

    // Check if settings already exist
    let settings = await AppSecrets.findOne();
    if (!settings) {
      settings = new AppSecrets({
        adminemail: "admin@safeplate.com",
        appicon: appIconUrl,
        applogo: appLogoUrl,
        adminphonenumber: adminphonenumber,
        GeminiClientKeys: GeminiClientKeys,
        GeminiClientSecret: GeminiClientSecret,
        FBClientkeys: FBClientkeys,
        FBClientSecret: FBClientSecret,
        AppleClientKeys: AppleClientKeys,
        AppleClientSecret: AppleClientSecret,
        GoogleClientSecretKeys: GoogleClientSecretKeys,
        GoogleClientKeys: GoogleClientKeys,
        PushNotificationclientkeys: PushNotificationclientkeys,
        PushNotificationclientsecret: PushNotificationclientsecret,
      });

      await settings.save();
    } else {
      throw {
        status: false,
        message: "App Secrets are already defined. You can try to update them",
      };
    }
    return {
      message: "app secrets Successfully added",
      success: true,
      settings,
    };
  },

  deleteAppSecrets: async (userId, { type }) => {
    let settings = await AppSecrets.findOne();

    if (!settings) {
      return {
        message: "App Secrets not found",
        success: false,
      };
    }

    // Check the type and delete the corresponding field
    switch (type) {
      case "appicon":
        settings.appicon = undefined;
        break;
      case "applogo":
        settings.applogo = undefined;
        break;
      case "adminphonenumber":
        settings.adminphonenumber = undefined;
        break;
      case "PushNotificationclientsecret":
        settings.PushNotificationclientsecret = undefined;
        break;
      case "PushNotificationclientkeys":
        settings.PushNotificationclientkeys = undefined;
        break;
      case "GoogleClientKeys":
        settings.GoogleClientKeys = undefined;
        break;
      case "GoogleClientSecretKeys":
        settings.GoogleClientSecretKeys = undefined;
        break;
      case "GeminiClientKeys":
        settings.GeminiClientKeys = undefined;
        break;
      case "GeminiClientSecret":
        settings.GeminiClientSecret = undefined;
        break;
      case "FBClientkeys":
        settings.FBClientkeys = undefined;
        break;
      case "FBClientSecret":
        settings.FBClientSecret = undefined;
        break;
      case "AppleClientKeys":
        settings.AppleClientKeys = undefined;
        break;
      case "AppleClientSecret":
        settings.AppleClientSecret = undefined;
        break;
      default:
        return {
          message: "Invalid type provided",
          success: false,
        };
    }

    await settings.save();

    return {
      message: `${type} successfully deleted`,
      success: true,
      settings,
    };
  },

  UpdateAppSecrets: async (userId, updates, files) => {
    // Find the user (assuming `findUserById` is a function that returns a user object)
    const user = await findUserById(userId);

    // Find the existing settings
    let settings = await AppSecrets.findOne({
      adminemail: "admin@safeplate.com",
    });

    if (!settings) {
      throw {
        message: "App secrets not found",
        success: false,
      };
    }

    // Prepare the fields to update
    const updateFields = {};

    // Handle file uploads if provided
    if (files) {
      const { appicon, applogo } = files;

      if (appicon) {
        const uploadAppIconResult = await updateToS3(settings.appicon, appicon);
        updateFields.appicon = uploadAppIconResult?.Location;
      }

      if (applogo) {
        const uploadAppLogoResult = await updateToS3(settings.applogo, applogo);
        updateFields.applogo = uploadAppLogoResult?.Location;
      }
    }

    // Include other updates in the updateFields object
    for (const key in updates) {
      if (updates.hasOwnProperty(key)) {
        updateFields[key] = updates[key];
      }
    }

    // Perform the update
    await AppSecrets.updateOne(
      { adminemail: "admin@safeplate.com" },
      { $set: updateFields }
    );

    // Fetch the updated settings
    settings = await AppSecrets.findOne({ adminemail: "admin@safeplate.com" });

    return {
      message: "App secrets successfully updated",
      success: true,
      settings,
    };
  },

  AddPagesData: async (userId, { termsconditions, aboutus, privacypolicy }) => {
    try {
      // Check if the document already exists
      const user = await findUserById(userId);
      let existingPage = await Pages.findOne({
        adminemail: "admin@safeplate.com",
      });
      if (existingPage) {
        if (!existingPage.pages[0]) {
          existingPage.pages[0] = {}; // Initialize pages[0] if it doesn't exist
        }

        // Assign the values safely
        if (privacypolicy) existingPage.pages[0].privacypolicy = privacypolicy;
        if (aboutus) existingPage.pages[0].aboutus = aboutus;
        if (termsconditions)
          existingPage.pages[0].termsconditions = termsconditions;

        await existingPage.save();

        return {
          message: "Page data successfully added",
          success: true,
          data: existingPage,
        };
      } else {
        // Create a new document
        const newPageData = new Pages({
          adminemail: "admin@safeplate.com",
          pages: [
            {
              termsconditions: termsconditions,
              privacypolicy: privacypolicy,
              aboutus: aboutus,
            },
          ],
        });

        await newPageData.save();

        return {
          message: "Page data successfully added",
          success: true,
          data: newPageData,
        };
      }
    } catch (error) {
      return {
        message: "Error adding or updating page data",
        success: false,
        error: error.message,
      };
    }
  },

  UpdatePagesData: async (
    userId,
    { termsconditions, privacypolicy, aboutus },
    { type }
  ) => {
    let existingPage = await Pages.findOne({
      adminemail: "admin@safeplate.com",
    });

    if (!existingPage) {
      return {
        message: "Page data not found",
        success: false,
      };
    }

    // Update the specified type of data
    let page = existingPage.pages[0]; // Assuming there is only one page object to update
    if (!page) {
      page = {};
      existingPage.pages.push(page);
    }

    switch (type) {
      case "termsconditions":
        page.termsconditions = termsconditions;
        break;
      case "privacypolicy":
        page.privacypolicy = privacypolicy;
        break;
      case "aboutus":
        page.aboutus = aboutus;
        break;
      default:
        return {
          message: "Invalid type specified",
          success: false,
        };
    }

    // Save the updated document
    await existingPage.save();

    return {
      message: `${type} successfully updated`,
      success: true,
      data: existingPage,
    };
  },

  GetPagesData: async (userId, { type }) => {
    const settings = await Pages.findOne({ adminemail: "admin@safeplate.com" });

    if (!settings) {
      return {
        message: "Page data not found",
        success: false,
      };
    }

    const page = settings.pages[0];

    let data = [];

    const addPageData = (name, pageData) => {
      if (pageData) {
        data.push({
          name,
          title: pageData.title,
          content: pageData.content,
        });
      }
    };

    switch (type) {
      case "termsconditions":
        addPageData("termsconditions", page?.termsconditions);
        break;
      case "privacypolicy":
        addPageData("privacypolicy", page?.privacypolicy);
        break;
      case "aboutus":
        addPageData("aboutus", page?.aboutus);
        break;
      case "all":
      default:
        addPageData("termsconditions", page?.termsconditions);
        addPageData("privacypolicy", page?.privacypolicy);
        addPageData("aboutus", page?.aboutus);
        break;
    }

    return {
      pagedata: data,
      message: "Page data retrieved successfully",
      success: true,
    };
  },

  GetSecrets: async (userId, { type }) => {
    const settings = await AppSecrets.findOne({
      adminemail: "admin@safeplate.com",
    });

    if (!settings) {
      throw {
        message: "Settings data not found",
        success: false,
      };
    }

    return {
      settings,
      message: "Secrets data retrieved successfully",
      success: true,
    };
  },

  DeletePagesData: async (userId, { type }) => {
    const settings = await Pages.findOne({ adminemail: "admin@safeplate.com" });

    if (!settings) {
      return {
        message: "Page data not found",
        success: false,
      };
    }

    const page = settings.pages[0];

    // Handle deletion
    switch (type) {
      case "termsconditions":
        page.termsconditions = undefined;
        break;
      case "privacypolicy":
        page.privacypolicy = undefined;
        break;
      case "aboutus":
        page.aboutus = undefined;
        break;
      case "all":
        page.termsconditions = undefined;
        page.privacypolicy = undefined;
        page.aboutus = undefined;
        break;
      default:
        return {
          message: "Invalid type for deletion",
          success: false,
        };
    }

    // Save the updated settings
    await settings.save();

    return {
      message: `${type} data deleted successfully`,
      success: true,
    };
  },

  Announcements: async (userId, data) => {
    const { title, description, customLinks } = data;

    // Create the announcement
    const newAnnouncement = new Announcement({
      title,
      description,
      customLinks,
      createdAt: new Date(),
    });

    await newAnnouncement.save();

    // Get all users from both collections
    let users = await userdb.find({});
    let gusers = await Gusers.find({});
    let allUsers = [...users, ...gusers];

    // Create user-specific announcement data
    const userAnnouncements = allUsers.map((user) => ({
      userId: user._id,
      announcementId: newAnnouncement._id,
      isCleared: false,
      isSeen: false,
      timestamp: new Date(),
    }));

    await UserAnnouncement.insertMany(userAnnouncements);

    // Send push notifications to users
    try {
      // await sendPushNotificationToAllUsers(title, description, customLinks);
    } catch (error) {
      console.error("Error sending notifications:", error);
    }

    const result = {
      message: "Announcement created and notifications sent.",
      success: true,
      announcement: newAnnouncement,
    };
    return result;
  },

  GetAnnouncements: async (userId, { page = 1, limit = 10 }) => {
    const skip = (page - 1) * limit;

    // Fetch announcements with pagination
    const announcements = await Announcement.find({})
      .skip(skip)
      .limit(limit)
      .sort({ createdAt: -1 }); // Optional: Sort by creation date in descending order

    // Count total number of announcements for pagination info
    const totalAnnouncements = await Announcement.countDocuments({});

    // Prepare the response
    const result = {
      success: true,
      message: "Announcements retrieved successfully",
      announcements,
      total: totalAnnouncements,
      page,
      limit,
      totalPages: Math.ceil(totalAnnouncements / limit),
    };
    return result;
  },

  DeleteAnnouncements: async (userId, { announcementId }) => {
    if (!announcementId) {
      throw {
        success: false,
        message: "Announcement ID is required",
      };
    }

    // Find and delete the announcement
    const announcement = await Announcement.findByIdAndDelete(announcementId);

    if (!announcement) {
      return {
        success: false,
        message: "Announcement not found",
      };
    }

    // Remove related user announcements
    await UserAnnouncement.deleteMany({ announcementId });

    return {
      success: true,
      message:
        "Announcement and related user announcements deleted successfully",
    };
  },

  getDashboardData: async ({ period }) => {
    const currentDate = new Date();
    let startDate;

    // Determine the start date based on the period
    if (period === "month") {
      startDate = new Date();
      startDate.setMonth(currentDate.getMonth() - 1);
    } else if (period === "threeMonths") {
      startDate = new Date();
      startDate.setMonth(currentDate.getMonth() - 3);
    } else if (period === "week") {
      startDate = new Date();
      startDate.setDate(currentDate.getDate() - 7);
    } else {
      startDate = new Date();
      startDate.setMonth(currentDate.getMonth() - 1); // Default to last month
    }

    // Get total counts (ignoring the period filter)
    const totalUsersCount =
      (await userdb.countDocuments()) + (await Gusers.countDocuments());
    const totalMembersCount = await Members.countDocuments();
    const totalPostCount = await Posts.countDocuments();
    const totalCommentsCount = await Posts.aggregate([
      { $unwind: "$comments" },
      { $count: "totalComments" },
    ]).then((result) => (result[0] ? result[0].totalComments : 0));

    // Get counts for the selected period
    const usersCount =
      (await userdb.countDocuments({ createdAt: { $gte: startDate } })) +
      (await Gusers.countDocuments({ createdAt: { $gte: startDate } }));
    const membersCount = await Members.countDocuments({
      createdAt: { $gte: startDate },
    });
    const postCount = await Posts.countDocuments({
      createdAt: { $gte: startDate },
    });

    const posts = await Posts.find({ createdAt: { $gte: startDate } });
    const commentsCount = posts.reduce(
      (count, post) => count + post.comments.length,
      0
    );

    // Determine the start date of the previous period for growth calculation
    const previousStartDate = new Date(startDate);
    let previousPeriodStartDate;

    if (period === "month") {
      previousPeriodStartDate = new Date(
        previousStartDate.setMonth(previousStartDate.getMonth() - 1)
      );
    } else if (period === "threeMonths") {
      previousPeriodStartDate = new Date(
        previousStartDate.setMonth(previousStartDate.getMonth() - 3)
      );
    } else if (period === "week") {
      previousPeriodStartDate = new Date(
        previousStartDate.setDate(previousStartDate.getDate() - 7)
      );
    } else {
      previousPeriodStartDate = new Date(
        previousStartDate.setMonth(previousStartDate.getMonth() - 1)
      ); // Default to previous month
    }

    // Get the counts for the previous period
    const previousUsersCount =
      (await userdb.countDocuments({
        createdAt: { $gte: previousPeriodStartDate, $lt: startDate },
      })) +
      (await Gusers.countDocuments({
        createdAt: { $gte: previousPeriodStartDate, $lt: startDate },
      }));
    const previousMembersCount = await Members.countDocuments({
      createdAt: { $gte: previousPeriodStartDate, $lt: startDate },
    });
    const previousPostCount = await Posts.countDocuments({
      createdAt: { $gte: previousPeriodStartDate, $lt: startDate },
    });

    // Get the previous comment counts
    const previousPosts = await Posts.find({
      createdAt: { $gte: previousPeriodStartDate, $lt: startDate },
    });
    const previousCommentsCount = previousPosts.reduce(
      (count, post) => count + post.comments.length,
      0
    );

    // Calculate the growth percentages
    const usersGrowth =
      ((usersCount - previousUsersCount) / (previousUsersCount || 1)) * 100;
    const membersGrowth =
      ((membersCount - previousMembersCount) / (previousMembersCount || 1)) *
      100;
    const postsGrowth =
      ((postCount - previousPostCount) / (previousPostCount || 1)) * 100;
    const commentsGrowth =
      ((commentsCount - previousCommentsCount) / (previousCommentsCount || 1)) *
      100;

    // Return the results including total counts and growth percentages
    return {
      totalUsers: totalUsersCount,
      usersGrowth: usersGrowth.toFixed(2) + "%",
      totalMembers: totalMembersCount,
      membersGrowth: membersGrowth.toFixed(2) + "%",
      totalPosts: totalPostCount,
      postsGrowth: postsGrowth.toFixed(2) + "%",
      totalComments: totalCommentsCount,
      commentsGrowth: commentsGrowth.toFixed(2) + "%",
      success: true,
    };
  },
};
