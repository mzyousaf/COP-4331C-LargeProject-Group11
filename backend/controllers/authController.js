const User = require('../models/user.model')
const Token = require('../models/token.model')
const Avail = require('../models/availability.model')
const bcrypt = require('bcrypt')
const jwt = require('jsonwebtoken')
const emailer = require('./emailer')
const {ACCESS_TOKEN_SECRET, ACCESS_TOKEN_LIFE, REFRESH_TOKEN_SECRET, REFRESH_TOKEN_LIFE} = process.env;
var generator = require('generate-password');
const { use } = require('../routes/router')

exports.signup = async (req, res) => {
    try {
        //check if username is already taken:
        var user
        user = await User.findOne({ userName: req.body.userName });
        if (user) {
            return res.status(200).json({ error: "Username taken." , id: -3 });
        } 
        // check if email taken
        user = await User.findOne({ email: req.body.email });
        if (user) {
            return res.status(200).json({ error: "Email in use." , id: -4 });
        }

        //create new user and generate a pair of tokens and send
        // user = await new User(req.body).save();
        var code = getRandomCode();
        console.log(code);
        user = await new User({email: req.body.email,
                            userName: req.body.userName,
                            password: req.body.password,
                            firstName: req.body.firstName,
                            lastName: req.body.lastName,
                            activationCode: code})
                            .save()

        emailer.sendRegistrationEmail(user.email, code);
    
        return res.status(201).json({ error: "" });
    } catch (e) {
        console.error(e);
        return res.status(500).json({ e: "Internal Server Error!" });
    }
};

function getRandomCode() {
    min = 1000000;
    max = 9999999;
    return Math.floor(Math.random() * (max-min) + min);
}

exports.activate = async (req, res) => {
    try {
        let code = req.params.code;
        let user = await User.findOne({ activationCode: code });
        if (!user) {
            return res.status(404).json({ error: "Cannot find user"})
        } else {
            await user.updateOne({$unset: {activationCode: ""}, active: true});
            await new Avail({userId: user._id, userName: user.userName}).save();
            console.log(`Created new availability redirecting to: ${process.env.ORIGIN}`);
            return res.status(200).redirect(process.env.ORIGIN);
        }
    } catch (e) {
        console.error(e);
        console.log(`Failed activation redirecting to: ${process.env.ORIGIN}`);
        return res.status(500).redirect(process.env.ORIGIN);
    }
}

exports.login = async (req, res) => {
    try {
        //check if user exists in database:
        let user = await User.findOne({ userName: req.body.userName });
        //send error if no user found:
        if (!user) {
            console.log('User not found!');
            return res.status(200).json({ id: -1 });
        } else {
            //check if password is valid:
            let valid = await bcrypt.compare(req.body.password, user.password);
            if (valid) {

                // Check if account is active
                if (!user.active) {
                    console.log('Email not verified!');
                    return res.status(200).json({ id: -2 });
                }

                //generate a pair of tokens if valid and send
                let accessToken = await user.createAccessToken();
                let refreshToken = await user.createRefreshToken();
                let id = user._id;
                let firstName = user.firstName;
                let lastName = user.lastName;
                let userName = user.userName;
                res.cookie('refreshToken', refreshToken, {httpOnly: true});
                return res.status(200).json({ accessToken, id, firstName, lastName, userName});
            } else {
                //send error if password is invalid
                console.log('Invalid password!');
                return res.status(200).json({ id: -1 });
            }
        }
    } catch (e) {
        console.error(e);
        return res.status(500).json({ e: "Internal Server Error!" });
    }
};

exports.refresh = async (req, res) => {
    try {
        //get refreshToken
        const refreshToken = req.cookies['refreshToken'];
        //send error if no refreshToken is sent
        if (!refreshToken) {
            return res.status(403).json({ error: "Access denied,token missing!" });
        } else {
            //query for the token to check if it is valid:
            const tokenDoc = await Token.findOne({ token: refreshToken });
            //send error if no token found:
            if (!tokenDoc) {
                return res.status(401).json({ error: "Token expired!" });
            } else {
                //extract payload from refresh token and generate a new access token and send it
                const payload = jwt.verify(tokenDoc.token, REFRESH_TOKEN_SECRET);
                const accessToken = jwt.sign({ user: payload.user }, ACCESS_TOKEN_SECRET, {
                expiresIn: ACCESS_TOKEN_LIFE,
                });
                return res.status(200).json({ accessToken });
            }
        }
    } catch (e) {
        console.error(e);
        return res.status(500).json({ e: "Internal Server Error!" });
    }
};

exports.logout = async (req, res) => {
    try {
        //delete the refresh token saved in database:
        const { userId } = req.body;
        await Token.deleteMany({userId: userId});
        return res.status(200).json({ success: true });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ error: "Internal Server Error!" });
    }
};

exports.forgotpass = async (req, res) => {
    try {
        const { userName, email } = req.body;
        var user = await User.findOne( {userName: userName, email: email} );
        if (!user) {
            return res.status(200).json( {success: false, error: ""} )
        } else {
            tempPassword = generator.generate({numbers: true, strict: true});
            console.log(`Temporary password ${tempPassword}`);
            user.password = tempPassword;
            await user.save();

            emailer.forgotPasswordEmail(user.email, tempPassword);
            return res.status(200).json( {success: true, error: ""} )
        }
    } catch (error) {
        console.error(error);
        return res.status(500).json({ error: "Internal Server Error!" })
    }
};

exports.changepass = async (req, res, next) => {
    try {
        let {id, userName} = req.user;
        const {password, newPassword} = req.body;
        var user = await User.findOne({ _id: id });
        let valid = await bcrypt.compare(password, user.password);
        if (valid) {
            user.password = newPassword;
            await user.save();
            return res.status(200).json({success: true, error: ""});
        } else {
            return res.status(200).json({success: false, error: "Old password is incorrect"})
        }
    } catch (error) {
        console.error(error);
        return res.status(500).json({ error: "Internal Server Error!" });
    }
}