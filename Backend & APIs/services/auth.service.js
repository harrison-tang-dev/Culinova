import { userdb, Gusers } from "../models/users/userSchema.js";
import {
  findUserById,
  findUserByEmail,
  returnUser,
  removeDeviceToken,
  generatePassword,
  AddNotificationForUser,
} from "../utils/helpers/authlogin.js";
import { USER, ERR_MESSAGES } from "../utils/ErrorMessages/messages.js";
import {
  generateAccessToken,
  generateRefreshToken,
} from "../utils/helpers/generateToken.js";
import Otp from "../models/users/otpmodel.js";
import bcrypt from "bcrypt";
import otpGenerator from "otp-generator";
import { uploadToS3, updateToS3 } from "../utils/helpers/s3func.js";

import mongoose from "mongoose";
import { Members } from "../models/users/members.js";
import { AppSecrets } from "../models/appsettings/secrets.js";
import { Posts } from "../models/community/posts.js";
import { sendMailfunction } from "../utils/helpers/mailsender.js";
import { emailverifiOtp } from "../models/users/emailverifyotp.js";
import { saveDeviceToken } from "../utils/helpers/authlogin.js";
import { deviceNotifi } from "../models/users/deviceToken.js";
import { onBoarding } from "../models/appsettings/onboarding.js";
import { OAuth2Client } from "google-auth-library";
import { UserAnnouncement, Announcement } from "../models/Admin/anouncemnet.js";
import { Chat } from "../models/community/chatdata.js";
import { Image } from "../models/users/Imagesdir.js";
import { sendPushNotification } from "../utils/helpers/sendpushNotification.js";
import { serviceAccount } from "../utils/helpers/firebaseconfig.js";
import initializeFirebase from "../utils/helpers/firebaseconfig.js";
import admin from "firebase-admin";
import { sendPushNotificationToAllUsers } from "../utils/helpers/sendpushNotification.js";
import { Notifications } from "../models/users/notifications.js";
import { dashService } from "./dash.service.js";
import axios from "axios";
import jwt from "jsonwebtoken";
import appleSignin from "apple-signin";

const CLIENT_ID = process.env.FCM_CLIENT_ID;
const client = new OAuth2Client(CLIENT_ID);

export const authService = {
  register: async ({
    name,
    email,
    password,
    phonenumber,
    countryCode,
    termscondition,
  }) => {
    const emailRegex = new RegExp(`^${email}$`, "i");
    let user = await userdb.findOne({ email: emailRegex });
    if (!user) {
      user = await Gusers.findOne({ email: emailRegex });
      if (user) {
        throw { status: 422, message: USER.USER_REGISTERED_EXISTS };
      }
    }
    if (user) {
      throw { status: 422, message: USER.USER_REGISTERED_EXISTS };
    }
    if (!user) {
      const newUserData = {
        name,
        email,
        password,
        termscondition,
        countryCode,
        roles: "user",
        profileurl: "",
      };

      // Only add phonenumber if it exists
      if (phonenumber) {
        newUserData.phonenumber = phonenumber;
      }

      const newuser = new userdb(newUserData);

      await newuser.save();
      // console.log(newuser);
      // Generate verification OTP
      const otp = await authService.generateOtpAndSave(
        newuser,
        "emailverifyotp"
      );
      await authService.sendOtpEmail(otp, newuser);
      return {
        success: true,
        message: "Verify OTP to complete registration",
        userdata: {
          name: newuser.name,
          email: newuser.email,
          phonenumber: newuser.phonenumber,
          otp: otp,
        },
      };
    }
  },

  login: async (data, { devicetoken }) => {
    const { email, password, termscondition } = data;
    if (!termscondition) {
      throw {
        status: 403,
        message: "Accept  terms and conditions to login",
      };
    }
    const userValid = await findUserByEmail(email);

    if (userValid) {
      const isMatch = await bcrypt.compare(password, userValid.password);

      if (!isMatch) {
        throw { status: 422, message: USER.INVALID_PASSWORD };
      }

      if (userValid?.roles === "user" && !userValid?.isEmailValidated) {
        throw {
          status: 403,
          message: "Please verify your email to continue",
        };
      }
      if (!userValid.approvedStatus) {
        throw {
          status: 403,
          message: "You are blocked by admin",
        };
      }

      if (userValid?.roles === "user" && userValid?.disabled) {
        throw {
          status: 403,
          message: USER.USER_DISABLED,
        };
      }

      if (devicetoken) {
        await saveDeviceToken(userValid, devicetoken);
      }

      return authService.loginUser(userValid);
    } else {
      return { status: 404, message: USER.USER_NOT_EXISTS };
    }
  },

  Googlelogin: async ({ token }, { devicetoken }) => {
    try {
      const tokenInfo = await client.getTokenInfo(token);

      const { email, name } = tokenInfo;
      const [namePart] = email.split("@");
      let userValid = await userdb.findOne({ email: email });
      if (!userValid) {
        userValid = await Gusers.findOne({ email: email });
      }
      if (userValid) {
        return authService.loginUser(userValid);
      } else {
        userValid = new Gusers({
          name: namePart,
          email: email.toLowerCase(),
          roles: "user",
          profileurl: "",
        });
        await userValid.save();

        if (devicetoken) {
          await saveDeviceToken(userValid, devicetoken);
        }
        return authService.loginUser(userValid);
      }
    } catch (error) {
      throw error;
    }
  },

  Applelogin: async ({ token }, { devicetoken }) => {
    try {
      // const appleKeys = await axios.get('https://appleid.apple.com/auth/keys');
      const decodedHeader = jwt.decode(token, { complete: true });
      const { email, name } = decodedHeader?.payload;
      const [namePart] = email.split("@");
      let userValid = await userdb.findOne({ email: email });
      if (!userValid) {
        userValid = await Gusers.findOne({ email: email });
      }
      if (userValid) {
        return authService.loginUser(userValid);
      } else {
        userValid = new Gusers({
          name: namePart,
          email: email.toLowerCase(),
          roles: "user",
          profileurl: "",
        });
        await userValid.save();

        if (devicetoken) {
          await saveDeviceToken(userValid, devicetoken);
        }
        return authService.loginUser(userValid);
      }
    } catch (error) {
      console.error(error);
      throw error;
    }
  },

  loginUser: async (userValid) => {
    const payload = {
      id: userValid._id,
      role: userValid.roles,
      disabled: userValid.disabled,
    };

    // Set the options for the token
    const options = {
      expiresIn: "25d",
    };

    const access_token = await generateAccessToken(
      payload,
      process.env.SECRET_KEY,
      options
    );
    //token is greater than the access token
    const refreshoptions = {
      expiresIn: "30d",
    };

    const refreshtoken = await generateRefreshToken(
      payload,
      process.env.REFRESH_TOKEN_SECRET,
      refreshoptions
    );

    userValid.refreshtoken.push(refreshtoken);
    await userValid.save();

    // Determine if this is the first login
    const firstlogin = userValid.refreshtoken.length === 1;

    const data = {
      _id: userValid._id,
      name: userValid.name,
      email: userValid.email,
      phonenumber: userValid?.phonenumber,
      firstlogin: firstlogin,
      disabled: userValid.disabled,
    };
    return {
      success: true,
      message: "User Login Success",
      data,
      access_token,
      refreshtoken,
    };
  },

  resendotp: async (data) => {
    const user = await findUserByEmail(data?.email);
    try {
      if (data?.type == "emailverifyotp") {
        await emailverifiOtp
          .findOneAndDelete({ email: data.email })
          .then(async () => {
            const otp = await authService.generateOtpAndSave(user, data?.type);
            await authService.sendOtpEmail(otp, user);
          });
      } else if (data?.type == "pswdotp") {
        await Otp.findOneAndDelete({ email: data.email }).then(async () => {
          const otp = await authService.generateOtpAndSave(user, data?.type);
        });
      }
      return {
        success: true,
        message: `OTP sent for email verification`,
      };
    } catch (error) {
      throw { message: error.message };
    }
  },

  generateOtpAndSave: async (user, type) => {
    let otp = otpGenerator.generate(4, {
      upperCaseAlphabets: false,
      lowerCaseAlphabets: false,
      specialChars: false,
      digits: true,
    });

    if (type == "emailverifyotp") {
      let result = await emailverifiOtp.findOne({ otp: otp });

      while (result) {
        otp = otpGenerator.generate(4, {
          upperCaseAlphabets: false,
          lowerCaseAlphabets: false,
          specialChars: false,
          digits: true,
        });
        result = await emailverifiOtp.findOne({ otp: otp });
      }

      const otpPayload = { email: user.email, otp, fname: user.name };
      const otpBody = await emailverifiOtp.create(otpPayload);
    } else {
      let result = await Otp.findOne({ otp: otp });

      otp = otpGenerator.generate(4, {
        upperCaseAlphabets: false,
        lowerCaseAlphabets: false,
        specialChars: false,
        digits: true,
      });
      result = await Otp.findOne({ otp: otp });

      const otpPayload = { email: user?.email, otp, name: user?.name };
      const otpBody = await Otp.create(otpPayload);
    }

    return otp;
  },

  sendOtpEmail: async (otp, user) => {
    const emaildata = {
      name: `${user.name}`,
      otp: otp,
    };
    // console.log(emaildata);

    await sendMailfunction(
      "emailverifyotp",
      emaildata,
      user.email,
      `verification email - SafeGate`
    );
  },

  forgotpassword: async (email) => {
    const userfind = await findUserByEmail(email);
    const name = userfind?.name;
    if (!userfind) {
      throw { status: 422, message: USER.USER_NOT_EXISTS };
    } else {
      // Generate OTP and save it
      const otp = await authService.generateOtpAndSave(userfind, "Otp");

      return {
        success: true,
        message: USER.OTP_SUCCESS,
        otp: otp,
      };
    }
  },

  verifyOTP: async (email, otp) => {
    const userfind = await findUserByEmail(email);

    if (!userfind) {
      throw {
        status: 401,
        message: USER.USER_NOT_EXISTS,
      };
    }

    const response = await Otp.find({ email }).sort({ createdAt: -1 }).limit(1);

    if (response.length === 0 || otp !== response[0].otp) {
      throw { status: 400, message: USER.OTP_INVALID };
    }

    await Otp.updateOne({ _id: response[0]._id }, { isverified: true });
    return {
      success: true,
      message: USER.OTP_VERIFIED,
    };
  },

  emailVerify: async (data) => {
    const { email, otp } = data;
    const userfind = await findUserByEmail(email);

    if (!userfind) {
      throw {
        status: 401,
        message: USER.USER_NOT_EXISTS,
      };
    }

    const response = await emailverifiOtp
      .find({ email })
      .sort({ createdAt: -1 })
      .limit(1);

    if (response.length === 0 || otp !== response[0].otp) {
      throw { status: 400, message: USER.OTP_INVALID };
    }

    await emailverifiOtp.updateOne(
      { _id: response[0]._id },
      { isverified: true }
    );
    userfind.isEmailValidated = true;
    await userfind.save();

    return {
      success: true,
      message: USER.OTP_VERIFIED,
    };
  },

  resendotp: async (data) => {
    const user = await findUserByEmail(data.email);
    try {
      if (data?.type == "emailverifyotp") {
        await emailverifiOtp
          .findOneAndDelete({ email: data.email })
          .then(async () => {
            const otp = await authService.generateOtpAndSave(user, data?.type);
            await authService.sendOtpEmail(otp, user);
          });
      } else if (data?.type == "pswdotp") {
        await Otp.findOneAndDelete({ email: data.email }).then(async () => {
          const otp = await authService.generateOtpAndSave(user, data?.type);
        });
      }
      return {
        success: true,
        message: `OTP sent for email verification`,
      };
    } catch (error) {
      throw { message: error.message };
    }
  },

  resetPassword: async (email, password) => {
    let validuser = await findUserByEmail(email);
    if (!validuser) {
      throw { status: 401, message: USER.USER_NOT_EXISTS };
    }

    const response = await Otp.find({ email }).sort({ createdAt: -1 }).limit(1);

    if (response.length === 0 || !response[0].isverified) {
      throw { status: 400, message: "Please verify OTP" };
    }

    // const newpassword = await bcrypt.hash(password, 12);
    try {
      validuser.password = password;
      await validuser.save();
    } catch (err) {
      throw { message: err.message };
    }

    return {
      sucess: true,
      email: validuser.email,
      message: USER.SET_PASSWORD_SUCCESS,
    };
  },

  getProfile: async (userId) => {
    const uservalid = await findUserById(userId);
    const user = await returnUser(uservalid);
    return {
      user,
      message: "User profile retrieved successfully",
      success: true,
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
      approve,
    },
    profilepic
  ) => {
    let filepath;
    let uservalid = await findUserById(userId);

    if (profilepic) {
      if (
        !uservalid.profileurl ||
        uservalid.profileurl === "" ||
        uservalid.profileurl === "/images/undefined"
      ) {
        // If no profile URL exists or it's empty/undefined, upload a new image
        filepath = await uploadToS3(profilepic);
      } else {
        // If a profile URL exists, update the existing image
        filepath = await updateToS3(uservalid?.profileurl, profilepic);
      }
      uservalid.profileurl = filepath?.Location;
    }

    // Update user details
    uservalid.name = name;
    uservalid.countryCode = countryCode;
    uservalid.postcode = postcode;
    uservalid.phonenumber = phonenumber;
    uservalid.age = Age;
    uservalid.dob = Dob;
    uservalid.aboutme = aboutme;
    uservalid.bmi = BMI;
    uservalid.health_conditions = health_conditions;
    uservalid.allergies = allergies;
    uservalid.gender = gender;
    uservalid.weight = weight;
    uservalid.Unit = Unit;
    uservalid.ft = ft;
    uservalid.others = others;
    uservalid.In = In;
    uservalid.Unit2 = Unit2;

    if (approve) {
      uservalid.isEmailValidated = approve;
    }

    await uservalid.save();

    const user = await returnUser(uservalid);
    return {
      user,
      message: "User profile updated successfully",
      success: true,
    };
  },

  updateProfileStatus: async (userId, { email, status }) => {
    const user = await findUserByEmail(email);

    user.approvedStatus = status;
    await user.save();
    const userdata = await returnUser(user);
    return {
      userdata,
      message: "User profile updated successfully",
      success: true,
    };
  },

  logout: async (userId, rftoken, { devicetoken }) => {
    const userValid = await findUserById(userId);
    if (devicetoken) {
      await removeDeviceToken(userId, devicetoken);
    }

    const index = userValid.refreshtoken.indexOf(rftoken);
    if (index !== -1) {
      // Remove the matched rftoken from the array
      userValid.refreshtoken.splice(index, 1);
    }

    await userValid.save();
    return { success: !!userValid, message: "User logged out successfully" };
  },

  AddFamilyMember: async (userId, data, profilepic, memberId) => {
    let filepath, uservalid;

    if (memberId) {
      uservalid = await findUserById(memberId);
    } else {
      uservalid = await findUserById(userId);
    }

    const { name, email, phonenumber, relationship, countryCode } = data;
    const usermember = await Members.findOne({
      $or: [
        { email: email, userId: uservalid._id.toString() },
        { userId: uservalid._id.toString(), phonenumber: phonenumber },
      ],
    });

    if (usermember) {
      let conflictField = "";
      if (usermember.email === email) {
        conflictField = "email";
      } else if (usermember.phonenumber === phonenumber) {
        conflictField = "phonenumber";
      }

      throw {
        status: 409,
        message: `User with the given ${conflictField} already exists`,
      };
    }

    const password = generatePassword();

    const familyMember = new Members({
      userId: uservalid._id,
      name: name,
      email: email,
      phonenumber: phonenumber,
      countryCode: countryCode,
      relationship: relationship,
      password: password, // Save the password
      profileurl: "",
    });

    // Save the family member first to get the _id
    await familyMember.save();

    // Upload the profile picture to S3
    filepath = await uploadToS3(profilepic);

    if (filepath) {
      // Update the family member with the profile picture URL
      familyMember.profileurl = filepath?.Location;
      await familyMember.save(); // Save again with the updated profile picture
    }

    // Send an email to the family member with the login credentials
    await sendMailfunction(
      "memberregister",
      { password, name },
      email,
      `Welcome - SafePlate`
    );

    return { message: "Member successfully added", success: true };
  },

  UpdateFamilyMember: async (
    userId,
    { name, email, phonenumber, relationship, countryCode, updateduserId },
    profilepic
  ) => {
    let filepath, member;

    member = await Members.findOne({ userId: userId, email: email });

    if (profilepic && (!member.profileurl || member.profileurl == "")) {
      filepath = await uploadToS3(profilepic);
    } else if (profilepic && member.profileurl != "") {
      filepath = await updateToS3(member.profileurl, profilepic);
    }
    if (filepath) {
      member.profileurl = filepath?.Location;
    }

    // member.userId= updateduserId,
    member.name = name;
    member.phonenumber = phonenumber;
    member.countryCode = countryCode;
    member.relationship = relationship;

    await member.save();
    const { password, ...memberData } = member.toObject();

    return {
      user: memberData,
      message: "Member profile updated successfuly",
      success: true,
    };
  },

  getMembers: async (userId, { membersemail, page = 1, limit = 10 }) => {
    let query = { userId: userId };
    let projection = { refreshtoken: 0, password: 0 };

    // Check if a specific member email is provided
    if (membersemail) {
      query.email = membersemail;
    }

    // Pagination calculations
    const skip = (page - 1) * limit;

    let Membersdata;

    if (membersemail) {
      // If specific member email is provided, find one member
      Membersdata = await Members.findOne(query, projection);
    } else {
      // Otherwise, find multiple members with pagination
      Membersdata = await Members.find(query, projection)
        .skip(skip)
        .limit(limit)
        .sort({ createdAt: -1 });
    }

    return {
      Membersdata,
      success: true,
      message: "Member profile retrieved successfully",
      page,
      limit,
    };
  },

  removeMembers: async (userId, membersemail) => {
    let Membersdata = await Members.findOneAndDelete({
      email: membersemail,
    });

    return { message: "Member deleted Successfully", success: true };
  },

  RemoveUser: async (userId) => {
    try {
      // Find the user by ID
      let result = await userdb.findOne({ _id: userId });
      if (result) {
        // Delete the user from userdb
        await userdb.findOneAndDelete({ _id: userId });

        // Delete the user's posts
        await dashService.deleteUserPostsAndImages(userId);

        return {
          success: true,
          message: "User and associated posts deleted successfully",
        };
      }

      // Check in Gusers collection
      result = await Gusers.findById(userId);
      if (result) {
        // Delete the user from Gusers
        await Gusers.findOneAndDelete({ _id: userId });

        // Delete the user's posts
        await dashService.deleteUserPostsAndImages(userId);

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
    } catch (error) {
      console.error(error);
      throw {
        success: false,
        message: "An error occurred while deleting the user",
        success: false,
      };
    }
  },

  DeletePostById: async (userId, postid) => {
    let Postdata = await Posts.findOneAndDelete({
      _id: postid,
    });

    return { message: "Post deleted Successfully", success: true };
  },

  AddPosts: async (
    userId,
    { name, title, caption, message, postimage },
    profilepic
  ) => {
    const post = new Posts({
      userId: userId,
      name: name,
      caption: caption,
      message: message,
      title: title,
      postimage: "",
    });
    await post.save();

    if (post) {
      const user = await findUserById(userId);
      const filepath = await uploadToS3(profilepic);

      if (filepath) {
        post.postimage = filepath?.Location;
        await post.save();
      }
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

  GetPost: async (userId, { page = 1, limit = 10 }) => {
    const user = await findUserById(userId);
    const skip = (page - 1) * limit;

    // Retrieve posts by userId with pagination
    const postdata = await Posts.find({ userId: userId })
      .skip(skip)
      .limit(limit)
      .sort({ createdAt: -1 });

    // Convert post IDs to strings
    const postIds = postdata.map((p) => p._id.toString());

    // Retrieve all images related to the user and their posts
    const images = await Image.find({
      userId: userId, // No conversion needed since userId is already a string
      postId: { $in: postIds }, // Ensure postId is treated as a string
    });

    // Map the images to the corresponding posts
    const post = postdata.map((p) => {
      const postImages = images
        .filter((img) => img.postId == p._id.toString()) // Ensure postId comparison as strings
        .map((img) => `/images/${img._id}`); // Map only the image URL
      const isLiked = p.likes.some(
        (like) => like.userId.toString() == userId.toString()
      );
      return {
        ...p.toObject(),
        name: user ? user.name : p.name,
        liked: isLiked,
      };
    });

    return {
      post,
      message: "Posts data retrieved",
      success: true,
      page,
      limit,
    };
  },

  GetPostById: async (userId, postId) => {
    // Find the post by postId
    const postdata = await Posts.findById(postId).exec();
    if (!postdata) {
      return {
        message: "Post not found",
        success: false,
      };
    }

    // Find the user who created the post
    const user = await findUserById(userId);

    // Fetch blocked users who blocked the current user
    let blockedUsers = await userdb.findById(userId);
    if (!blockedUsers) {
      blockedUsers = await Gusers.findById(userId);
    }

    const blockedUserIds =
      blockedUsers?.blockuser.map((id) => id.toString()) || [];

    const commentsWithProfiles = await Promise.all(
      postdata.comments
        .filter(
          (comment) => !blockedUserIds.includes(comment.userId.toString())
        )
        .filter(
          (comment) =>
            comment.userId == userId || comment.userId == postdata.userId
        )
        .map(async (comment) => {
          const commentUser = await findUserById(comment.userId);

          // Filter out replies from blocked users
          const repliesWithProfiles = await Promise.all(
            comment.replies
              .filter(
                (reply) => !blockedUserIds.includes(reply.userId.toString())
              ) // Exclude blocked users' replies
              .map(async (reply) => {
                const replyUser = await findUserById(reply.userId);
                return {
                  ...reply.toObject(),
                  profileImageUrl: replyUser.profileurl || "",
                };
              })
          );

          return {
            ...comment.toObject(),
            profileImageUrl: commentUser.profileurl || "",
            replies: repliesWithProfiles,
          };
        })
    );

    // Update the post object with the user's name, associated images, and enriched comments
    const post = {
      ...postdata.toObject(),
      name: user.name,
      profileImageUrl: user.profileurl || null,
      comments: commentsWithProfiles, // Updated comments with filtered profiles and replies
    };

    return {
      post,
      message: "Post data retrieved",
      success: true,
    };
  },

  GetAllPost: async (userId, { type, page = 1, limit = 10, name, title }) => {
    const skip = (page - 1) * limit;

    // Fetch posts based on type
    let postQuery = {};
    if (type === "liked") {
      postQuery = { "likes.userId": userId };
    }
    const blockedUsers = await userdb
      .find({ blockuser: userId })
      .select("_id")
      .lean();

    if (blockedUsers.length > 0) {
      const blockedUserIds = blockedUsers.map((user) => user._id);
      postQuery.userId = { $nin: blockedUserIds };
    }
    console.log(blockedUsers);
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

    // If no posts found
    if (!postdata.length) {
      return {
        post: [],
        message: "No posts found",
        success: true,
        page,
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

    // Format posts with user and image data
    const post = postdata.map((post) => {
      const isLiked = post.likes.some(
        (like) => like.userId.toString() == userId.toString()
      );
      const userInfo = userMap[post.userId.toString()] || {};
      const commentsWithProfileImages = post.comments.map((comment) => {
        const commentUserInfo = userMap[comment.userId.toString()] || {};
        return {
          ...comment,
          profileImageUrl: commentUserInfo.profileurl || "",
        };
      });

      return {
        _id: post._id,
        userId: post.userId,
        title: post.title,
        name: userInfo.name,
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
      post,
      message: "Posts data retrieved",
      success: true,
      page,
      limit,
    };
  },

  LikePost: async (userId, postId) => {
    const user = await findUserById(userId);
    const post = await Posts.findById(postId);
    const deviceTokens = await deviceNotifi.findOne({ userId: post?.userId });

    if (!post) {
      throw { status: 404, message: "Post not found" };
    }

    const alreadyLiked = post.likes.some((like) => like.userId == userId);

    if (alreadyLiked) {
      // Unlike the post
      post.likes = post.likes.filter((like) => like.userId !== userId);
      if (post.likeCount > 0) {
        post.likeCount -= 1;
      }
      await post.save();
      return { post, success: true, message: "Post disliked successfully" };
    } else {
      // Like the post
      post.likes.push({ userId });
      post.likeCount += 1;

      await post.save();

      // Send push notification to the post owner
      if (deviceTokens) {
        const notificationData = {
          message: `Your post was liked by ${user?.name}`,
        };
        // await sendPushNotification(notificationData, [deviceTokens.regtoken]);
        await AddNotificationForUser(
          userId,
          `Your post was liked by ${user?.name}`,
          postId
        );
      }

      return { post, success: true, message: "Post Liked successfully" };
    }
  },

  LikeComment: async (postId, commentId, userId, replyId = null) => {
    const user = await findUserById(userId);
    const post = await Posts.findById(postId);
    const deviceTokens = await deviceNotifi.findOne({ userId: post?.userId });

    if (!post) {
      throw { status: 404, message: "Post not found" };
    }

    let target;
    if (replyId) {
      // Like or unlike a reply
      const comment = post.comments.id(commentId);
      if (!comment) {
        throw { status: 404, message: "Comment not found" };
      }

      const reply = comment.replies.id(replyId);
      if (!reply) {
        throw { status: 404, message: "Reply not found" };
      }

      const alreadyLiked = reply.likes.some((like) => like.userId === userId);

      if (alreadyLiked) {
        reply.likes = reply.likes.filter((like) => like.userId !== userId);
        if (reply.likeCount > 0) {
          reply.likeCount -= 1;
        }
      } else {
        reply.likes.push({ userId });
        reply.likeCount += 1;

        // Send push notification to the reply owner
        if (deviceTokens) {
          const notificationData = {
            message: `Your reply was liked by ${user?.name}`,
          };
          // await sendPushNotification(notificationData, [deviceTokens.regtoken]);
          await AddNotificationForUser(
            userId,
            `Your reply was liked by ${user?.name}`,
            postId
          );
        }
      }
      target = reply;
    } else {
      // Like or unlike a comment
      const comment = post.comments.id(commentId);
      if (!comment) {
        throw { status: 404, message: "Comment not found" };
      }

      const alreadyLiked = comment.likes.some((like) => like.userId === userId);

      if (alreadyLiked) {
        comment.likes = comment.likes.filter((like) => like.userId !== userId);
        if (comment.likeCount > 0) {
          comment.likeCount -= 1;
        }
      } else {
        comment.likes.push({ userId });
        comment.likeCount += 1;

        // Send push notification to the comment owner
        if (deviceTokens) {
          const notificationData = {
            message: `Your comment was liked by ${user?.name}`,
          };
          // await sendPushNotification(notificationData, [deviceTokens.regtoken]);
          await AddNotificationForUser(
            userId,
            `Your comment was liked by ${user?.name}`,
            postId
          );
        }
      }
      target = comment;
    }

    await post.save();
    return {
      target,
      success: true,
      message: "Likes added successfully",
    };
  },
  AddComment: async (
    userId,
    postId,
    { commentId, name, message, profileurl }
  ) => {
    const user = await findUserById(userId);
    const post = await Posts.findById(postId);
    const deviceTokens = await deviceNotifi.findOne({ userId: post?.userId });

    if (!post) {
      throw { status: 404, message: "Post not found" };
    }

    if (commentId) {
      // Add a reply to an existing comment
      const comment = post.comments.id(commentId);

      if (!comment) {
        throw { status: 404, message: "Comment not found" };
      }

      const newReply = {
        userId,
        name,
        message,
        profileurl,
        likes: [],
        likeCount: 0,
      };

      comment.replies.push(newReply);
      await post.save();

      // Send push notification to the comment owner
      if (deviceTokens) {
        const notificationData = {
          message: `${user?.name} replied to your comment`,
        };
        // await sendPushNotification(notificationData, [deviceTokens.regtoken]);
        await AddNotificationForUser(
          userId,
          `${user?.name} replied to your comment`,
          postId
        );
      }
      return { comment, success: true, message: "Comments added successfully" };
    } else {
      // Add a new comment to the post
      const newComment = {
        userId,
        name,
        message,
        profileurl,
        likes: [],
        likeCount: 0,
        replies: [],
      };

      post.comments.push(newComment);
      await post.save();

      // Send push notification to the post owner
      if (deviceTokens) {
        const notificationData = {
          message: `${user?.name} commented on your post`,
        };
        // await sendPushNotification(notificationData, [deviceTokens.regtoken]);
        await AddNotificationForUser(
          userId,
          `${user?.name} commented on your post`,
          postId
        );
      }

      return { post, success: true, message: "Comments added successfully" };
    }
  },

  getAppOnboarding: async (userId, type) => {
    try {
      const settings = await onBoarding.findOne();

      if (!settings) {
        return {
          message: "Onboarding settings not found",
          success: false,
        };
      }

      let data;
      switch (type) {
        case "onboarding1":
          data = settings.onboarding1;
          break;
        case "onboarding2":
          data = settings.onboarding2;
          break;
        case "onboarding3":
          data = settings.onboarding3;
          break;
        default:
          data = settings;
          break;
      }

      return {
        data,
        message: "Onboarding data retrieved successfully",
        success: true,
      };
    } catch (error) {
      return {
        message: "Error retrieving onboarding data",
        success: false,
        error: error.message,
      };
    }
  },

  GetSecrets: async (userId, { type }) => {
    try {
      // const user = findUserById(userId);
      const settings = await AppSecrets.findOne();

      if (!settings) {
        return {
          message: "Page data not found",
          success: false,
        };
      }

      let data;
      switch (type) {
        case "GeminiKeys":
          data = settings.GeminiKeys;
          break;
        case "FBkeys":
          data = settings.FBkeys;
          break;
        case "AppleKeys":
          data = settings.AppleKeys;
          break;
        case "GoogleKeys":
          data = settings.GoogleKeys;
          break;
        case "PushNoificationkeys":
          data = settings.PushNoificationkeys;
          break;
        default:
          // Return all data if type is not specified or invalid
          data = settings;
          break;
      }

      return {
        data,
        message: "Secrets data retrieved successfully",
        success: true,
      };
    } catch (error) {
      return {
        message: "Error retrieving page data",
        success: false,
        error: error.message,
      };
    }
  },

  // GetAnnouncements API

  getAnnouncements: async (userId, data) => {
    const { page = 1, limit = 10 } = data;

    const skip = (page - 1) * limit;

    // Find user-specific announcements that have not been cleared
    const userAnnouncements = await UserAnnouncement.find({
      userId,
      isCleared: false,
    })
      .skip(skip)
      .limit(limit)
      .populate("announcementId");

    const announcements = userAnnouncements.map((userAnn) => ({
      type: "announcement",
      ...userAnn.announcementId.toObject(), // Convert to plain object
    }));

    // Find user-specific notifications that are unread
    const userNotifications = await Notifications.find({
      userId,
      isRead: false,
    })
      .skip(skip)
      .limit(limit);

    const notifications = userNotifications.map((notification) => ({
      type: "notification",
      ...notification.toObject(), // Convert to plain object
    }));

    // Merge announcements and notifications
    const mergedData = [...announcements, ...notifications];

    return {
      announcements: mergedData,
      message: "Announcements and notifications retrieved successfully.",
      success: true,
      page,
      limit,
    };
  },

  ClearAnnouncemnet: async (userId, data) => {
    const { announcementId } = data;
    let userAnnouncement = await UserAnnouncement.findOne({
      userId,
      announcementId,
    });

    if (!userAnnouncement) {
      userAnnouncement = await UserAnnouncement.findOne({
        _id: announcementId,
      });
      return {
        message: "Notifications not found for the user",
        success: false,
      };
    }

    // Update the isCleared field to true
    userAnnouncement.isCleared = true;
    await userAnnouncement.save();

    return {
      message: "Notifications cleared for user",
      success: true,
    };
  },

  SaveChat: async (userId, { message, sender }) => {
    const chat = new Chat({
      userId,
      message,
      sender,
    });

    await chat.save();
    return { success: true, message: "Chat saved successfully." };
  },

  getChatData: async (userId, { page = 1, limit = 20 }) => {
    const skip = (page - 1) * limit;

    const chatData = await Chat.find({ userId })
      .sort({ timestamp: -1 })
      .skip(skip)
      .limit(limit);

    const totalChats = await Chat.countDocuments({ userId });
    const totalPages = Math.ceil(totalChats / limit);

    return {
      success: true,
      message: "Chat data retrieved successfully.",
      chats: chatData,
      pagination: {
        totalChats,
        totalPages,
        currentPage: page,
        limit,
      },
    };
  },
  blockUser: async (auth_user_id, block_user_id) => {
    if (block_user_id == auth_user_id)
      return { success: false, message: "You can't block your self" };

    const userdata = await userdb.findById(auth_user_id);
    if (!userdata) {
      const guser = await Gusers.findById(auth_user_id);
      if (!guser) {
        return { success: false, message: "User not found" };
      }
      if (guser.blockuser.includes(block_user_id)) {
        return { success: false, message: "User is already blocked" };
      }

      guser.blockuser.push(block_user_id);
      await guser.save();

      return { success: true, message: "User blocked successfully" };
    }

    if (userdata.blockuser.includes(block_user_id)) {
      return { success: false, message: "User is already blocked" };
    }

    userdata.blockuser.push(block_user_id);
    await userdata.save();

    return { success: true, message: "User blocked successfully" };
  },
};
